// Write-ahead EVM outbox: persist signed bytes before broadcasting. Operator only.
import { keccak256, parseTransaction, recoverTransactionAddress, type Hex, type TransactionSerialized } from 'viem';
import { z } from 'zod';
import { blockHashSchema, FinalityConflictError, type ReceiptFinality } from './finality.js';
import { OperatorStore, transactionRequestSchema, type TransactionRequest, type TransactionState } from './store.js';

const receiptSchema = z.object({ status: z.enum(['success', 'reverted']), blockNumber: z.bigint().nonnegative(), gasUsed: z.bigint().nonnegative(), blockHash: blockHashSchema.optional(), transactionHash: blockHashSchema.optional() });
export type ConfirmedReceipt = z.infer<typeof receiptSchema>;
interface TransactionPortBase {
  chainId: number;
  sender: Hex;
  /** Prepare and sign locally; this method MUST NOT broadcast. */
  prepare(request: TransactionRequest): Promise<Hex>;
  broadcast(raw: Hex): Promise<Hex>;
  receipt(hash: Hex): Promise<ConfirmedReceipt | null>;
  waitReceipt(hash: Hex): Promise<ConfirmedReceipt>;
  /** Required on real chains; absent only for local fixture ports. */
  finality?(receipt: ConfirmedReceipt): Promise<ReceiptFinality>;
  assertSafe?(): Promise<void>;
  onFinalityConflict?(error: FinalityConflictError): Promise<void>;
}
export type TransactionPort = TransactionPortBase & (
  | { finalityMode: 'local' }
  | { finalityMode: 'finalized'; finality(receipt: ConfirmedReceipt): Promise<ReceiptFinality>;
      assertSafe(): Promise<void>; onFinalityConflict(error: FinalityConflictError): Promise<void> }
);

export class DurableSender {
  private lock: Promise<unknown> = Promise.resolve();
  constructor(private store: OperatorStore, private port: TransactionPort) {
    if (store.scope.chainId !== port.chainId || store.scope.sender !== port.sender.toLowerCase() || store.scope.finalityMode !== port.finalityMode) {
      throw new Error('Transaction sender scope does not match the store.');
    }
    if (port.finalityMode === 'finalized' && (!port.finality || !port.assertSafe || !port.onFinalityConflict)) {
      throw new Error('Finalized sender requires finality, publication safety and conflict handlers.');
    }
  }

  send(id: string, input: TransactionRequest): Promise<TransactionState> {
    return this.exclusive(async () => {
      const request = transactionRequestSchema.parse(input);
      let state = this.store.transaction(id);
      if (state && JSON.stringify(state.request) !== JSON.stringify(request)) throw new Error('Operation id already has different transaction contents.');
      if (!state) {
        await this.port.assertSafe?.();
        // Validate prior inclusions before nonce allocation, including callers
        // that use send() directly rather than the release runner's recover().
        for (const previous of this.store.transactions()) {
          if (previous.status === 'included' || (this.port.finality && previous.status !== 'signed')) await this.settle(previous);
        }
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
        if (state.status === 'signed' || state.status === 'included' || this.port.finality) recovered.push(await this.settle(state));
      }
      return recovered;
    });
  }

  /** A new attempt is permitted only after a recorded finalized revert. */
  nextAttemptId(prefix: string): string | null {
    const attempts = this.store.transactions().filter((t) => t.id === prefix || t.id.startsWith(`${prefix}/retry/`));
    if (!attempts.length) return prefix;
    return attempts.at(-1)?.status === 'reverted' ? `${prefix}/retry/${attempts.length}` : null;
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

  private async conflict(message: string): Promise<never> {
    const error = new FinalityConflictError(message);
    await this.port.onFinalityConflict?.(error); throw error;
  }

  private async settle(state: TransactionState): Promise<TransactionState> {
    await this.validate(state);
    const terminal = state.status === 'confirmed' || state.status === 'reverted';
    if (terminal) {
      if (!this.port.finality) return state; // In-process EVM fixtures only.
      if (!state.block || !state.blockHash || !state.gas) throw new Error('Terminal receipt has no finality anchor.');
      const finality = await this.port.finality({ status: state.status === 'confirmed' ? 'success' : 'reverted',
        blockNumber: BigInt(state.block), blockHash: state.blockHash, gasUsed: BigInt(state.gas), transactionHash: state.hash as Hex });
      if (finality === 'orphaned') return this.conflict('A finalized transaction block changed; operator reconciliation is required.');
      if (finality !== 'finalized') throw new Error('RPC finality is behind an already finalized receipt.');
      return state;
    }
    const hash = state.hash as Hex;
    let receipt = await this.port.receipt(hash);
    if (receipt) {
      receipt = receiptSchema.parse(receipt);
      if (receipt.transactionHash && receipt.transactionHash !== hash) throw new Error('RPC receipt belongs to another transaction.');
      if (this.port.finality && await this.port.finality(receipt) === 'orphaned') receipt = null;
    }
    if (state.status === 'included') {
      if (!this.port.finality || !state.block || !state.blockHash || !state.gas || !state.receiptStatus) throw new Error('Included receipt has no finality anchor.');
      const oldFinality = await this.port.finality({ status: state.receiptStatus, blockNumber: BigInt(state.block),
        blockHash: state.blockHash, gasUsed: BigInt(state.gas), transactionHash: hash });
      const changed = !receipt || receipt.blockHash !== state.blockHash || receipt.blockNumber.toString() !== state.block;
      if (changed && oldFinality !== 'orphaned') throw new Error('RPC receipt is missing or inconsistent for a canonical inclusion; retry a healthy endpoint.');
      if (oldFinality === 'orphaned') state = this.store.reopenTransaction(state.id);
    }
    if (!receipt) {
      await this.port.assertSafe?.(); // Outside the catch: safety failures must stop publication.
      try {
        const broadcastHash = await this.port.broadcast(state.raw as Hex);
        if (broadcastHash.toLowerCase() !== hash.toLowerCase()) throw new Error('RPC returned a different transaction hash.');
      } catch {
        // Already-known/nonce-too-low/lost response is not success. Wait for the original hash.
      }
      receipt = await this.port.waitReceipt(hash);
    }
    const checked = receiptSchema.parse(receipt);
    if (checked.transactionHash && checked.transactionHash !== hash) throw new Error('RPC receipt belongs to another transaction.');
    if (this.port.finality && (!checked.blockHash || !checked.transactionHash)) throw new Error('Receipt has no canonical transaction/block anchor.');
    const finality = this.port.finality ? z.enum(['pending', 'finalized', 'orphaned']).parse(await this.port.finality(checked)) : 'finalized';
    if (finality === 'orphaned') throw new Error('Transaction receipt is orphaned; retry canonical reconciliation.');
    const result: TransactionState = { ...state, status: finality === 'pending' ? 'included' : checked.status === 'success' ? 'confirmed' : 'reverted',
      receiptStatus: checked.status, blockHash: checked.blockHash,
      block: checked.blockNumber.toString(), gas: checked.gasUsed.toString() };
    this.store.saveTransaction(result);
    return result;
  }
}
