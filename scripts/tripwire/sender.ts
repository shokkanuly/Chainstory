// Write-ahead EVM outbox: persist signed bytes before broadcasting. Operator only.
import { keccak256, parseTransaction, recoverTransactionAddress, type Hex, type TransactionSerialized } from 'viem';
import { z } from 'zod';
import { OperatorStore, transactionRequestSchema, type TransactionRequest, type TransactionState } from './store.js';

const receiptSchema = z.object({ status: z.enum(['success', 'reverted']), blockNumber: z.bigint().nonnegative(), gasUsed: z.bigint().nonnegative() });
export type ConfirmedReceipt = z.infer<typeof receiptSchema>;
export interface TransactionPort {
  chainId: number;
  sender: Hex;
  /** Prepare and sign locally; this method MUST NOT broadcast. */
  prepare(request: TransactionRequest): Promise<Hex>;
  broadcast(raw: Hex): Promise<Hex>;
  receipt(hash: Hex): Promise<ConfirmedReceipt | null>;
  waitReceipt(hash: Hex): Promise<ConfirmedReceipt>;
}

export class DurableSender {
  private lock: Promise<unknown> = Promise.resolve();
  constructor(private store: OperatorStore, private port: TransactionPort) {
    if (store.scope.chainId !== port.chainId || store.scope.sender !== port.sender.toLowerCase()) {
      throw new Error('Transaction sender scope does not match the store.');
    }
  }

  send(id: string, input: TransactionRequest): Promise<TransactionState> {
    return this.exclusive(async () => {
      const request = transactionRequestSchema.parse(input);
      let state = this.store.transaction(id);
      if (state && JSON.stringify(state.request) !== JSON.stringify(request)) throw new Error('Operation id already has different transaction contents.');
      if (!state) {
        if (this.store.transactions().some((t) => t.status === 'signed')) throw new Error('Recover the outstanding transaction before preparing another.');
        const raw = await this.port.prepare(request);
        state = { id, request, raw, hash: keccak256(raw), status: 'signed' };
        await this.validate(state);
        this.store.saveTransaction(state); // no network send before this commit
      }
      return this.settle(state);
    });
  }

  recover(): Promise<TransactionState[]> {
    return this.exclusive(async () => {
      const recovered: TransactionState[] = [];
      for (const state of this.store.transactions()) {
        if (state.status === 'signed') recovered.push(await this.settle(state));
      }
      return recovered;
    });
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.lock.then(work, work); this.lock = run.catch(() => undefined); return run;
  }

  private async validate(state: TransactionState): Promise<void> {
    const raw = state.raw as Hex;
    const tx = parseTransaction(raw);
    const sender = await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized });
    if (keccak256(raw) !== state.hash || tx.chainId !== this.port.chainId || sender.toLowerCase() !== this.store.scope.sender ||
      tx.to?.toLowerCase() !== state.request.to || (tx.data ?? '0x') !== state.request.data || (tx.value ?? 0n).toString() !== state.request.value) {
      throw new Error('Journaled signed transaction does not match its request or deployment scope.');
    }
  }

  private async settle(state: TransactionState): Promise<TransactionState> {
    await this.validate(state);
    if (state.status !== 'signed') return state;
    const hash = state.hash as Hex;
    let receipt = await this.port.receipt(hash);
    if (!receipt) {
      try {
        const broadcastHash = await this.port.broadcast(state.raw as Hex);
        if (broadcastHash.toLowerCase() !== hash.toLowerCase()) throw new Error('RPC returned a different transaction hash.');
      } catch {
        // Already-known, nonce-too-low, or a lost broadcast response is not a
        // terminal rejection. Only an actual receipt resolves the signed job.
      }
      receipt = await this.port.waitReceipt(hash);
    }
    const checked = receiptSchema.parse(receipt);
    const result: TransactionState = { ...state, status: checked.status === 'success' ? 'confirmed' : 'reverted',
      block: checked.blockNumber.toString(), gas: checked.gasUsed.toString() };
    this.store.saveTransaction(result);
    return result;
  }
}
