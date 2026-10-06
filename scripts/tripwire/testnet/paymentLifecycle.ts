// Receipt-backed milestones for listed customer credits; never an execution gate.
import { decodeEventLog, keccak256, stringToHex, type Abi, type Hex } from 'viem';
import { z } from 'zod';
import { cctpAddressSchema, cctpBytesSchema } from '../../../src/chains/evm/cctp.js';
import type { CctpRpc } from '../cctp.js';
import { blockHashSchema, blockHeaderSchema, FinalityConflictError } from '../finality.js';
import type { SourceProof } from '../sourceProof.js';
import paymentArtifact from './cctpPaymentEscrow.artifact.js';

export const PAYMENT_HISTORY_BLOCK_LIMIT = 128_000n;
export interface LifecycleAnchor { transactionHash: Hex; blockNumber: bigint; blockHash: Hex; timestamp: bigint; logIndex: number }
export type PaymentLifecycle = { version: 1; status: 'unavailable'; reason: string } | {
  version: 1; status: 'verified'; burn: LifecycleAnchor; mint: LifecycleAnchor;
  returnRequest?: LifecycleAnchor & { readyAt: bigint };
  outcome?: LifecycleAnchor & { kind: 'paid' | 'returned' };
};
export interface PaymentHistoryReader extends CctpRpc {
  readPaymentEvents?(messageId: Hex, fromBlock: bigint, toBlock: bigint): Promise<unknown>;
}
const logSchema = z.object({ address: cctpAddressSchema, blockNumber: z.bigint().nonnegative(), blockHash: blockHashSchema,
  transactionHash: blockHashSchema, logIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), removed: z.literal(false),
  topics: z.array(blockHashSchema).min(1).max(4), data: cctpBytesSchema });
const logsSchema = z.array(logSchema).max(1000);
const receiptSchema = z.object({ transactionHash: blockHashSchema, blockNumber: z.bigint().nonnegative(), blockHash: blockHashSchema,
  status: z.literal('success'), logs: logsSchema });
const eventNames = ['ReturnRequested', 'ReleaseExecuted', 'CreditReturned'] as const;
const events = paymentArtifact.abi.filter((item) => item.type === 'event' && eventNames.some((name) => name === item.name));
export const paymentLifecycleEvents = events;
const signatures = new Map(events.map((event) => {
  if (event.type !== 'event') throw new Error('Lifecycle ABI event missing.');
  return [keccak256(stringToHex(`${event.name}(${event.inputs.map((input) => input.type).join(',')})`)), event.name];
}));
const eventArgs = z.object({ messageId: blockHashSchema, recipient: cctpAddressSchema.optional(), to: cctpAddressSchema.optional(),
  amount: z.bigint().positive().optional(), readyAt: z.bigint().nonnegative().optional() });

export async function readPaymentLifecycle(input: {
  proof: SourceProof; source: CctpRpc; destination: PaymentHistoryReader; vault: Hex;
  head: z.infer<typeof blockHeaderSchema>; state: string; returnAt: bigint; recoveryDelay: bigint;
}): Promise<PaymentLifecycle> {
  const { proof, source, destination, head, vault } = input;
  try {
    const header = async (rpc: CctpRpc, anchor: { blockNumber: bigint; blockHash: Hex }, committed = false) => {
      const b = blockHeaderSchema.parse(await rpc.getBlock({ blockNumber: anchor.blockNumber }));
      if (b.number !== anchor.blockNumber || b.hash !== anchor.blockHash) {
        if (committed) throw new FinalityConflictError('Authenticated payment lifecycle backing block changed.');
        throw new Error('Lifecycle receipt is not canonical.');
      }
      return b;
    };
    const [burnBlock, mintBlock] = await Promise.all([header(source, proof.source, true), header(destination, proof.destination, true)]);
    if (proof.destination.blockNumber > head.number || mintBlock.timestamp > head.timestamp) throw new Error('Mint is ahead of the observation.');
    const anchorFrom = (origin: SourceProof['source'], timestamp: bigint): LifecycleAnchor => ({ transactionHash: origin.transactionHash,
      blockNumber: origin.blockNumber, blockHash: origin.blockHash, logIndex: origin.logIndex, timestamp });
    const burn = anchorFrom(proof.source, burnBlock.timestamp), mint = anchorFrom(proof.destination, mintBlock.timestamp);
    let returnRequest: (LifecycleAnchor & { readyAt: bigint }) | undefined;
    let outcome: (LifecycleAnchor & { kind: 'paid' | 'returned' }) | undefined;
    const terminal = input.state === 'EXECUTED' || input.state === 'RETURNED';
    if (input.returnAt > 0n || terminal) {
      if (!destination.readPaymentEvents) throw new Error('Receipt history reader is not configured.');
      if (head.number - mint.blockNumber >= PAYMENT_HISTORY_BLOCK_LIMIT) throw new Error('Receipt history exceeds the bounded scan range.');
      const logs = logsSchema.parse(await destination.readPaymentEvents(proof.messageId, mint.blockNumber, head.number));
      const positions = new Set<string>();
      for (const log of logs) {
        const position = `${log.blockNumber}/${log.logIndex}`;
        if (positions.has(position)) throw new Error('Duplicate lifecycle log.');
        positions.add(position);
        const name = signatures.get(log.topics[0]);
        if (!name || log.address !== vault || log.blockNumber < mint.blockNumber || log.blockNumber > head.number ||
          (log.blockNumber === mint.blockNumber && log.logIndex <= mint.logIndex)) throw new Error('Lifecycle log is outside the payment scope.');
        const args = eventArgs.parse(decodeEventLog({ abi: events as Abi, eventName: name, data: log.data,
          topics: log.topics as [Hex, ...Hex[]], strict: true }).args);
        if (args.messageId !== proof.messageId) throw new Error('Lifecycle log has the wrong payment ID.');
        const receipt = receiptSchema.parse(await destination.getTransactionReceipt({ hash: log.transactionHash }));
        if (receipt.transactionHash !== log.transactionHash || receipt.blockNumber !== log.blockNumber || receipt.blockHash !== log.blockHash) throw new Error('Lifecycle receipt anchor mismatch.');
        const indices = new Set<number>();
        for (const item of receipt.logs) {
          if (item.transactionHash !== receipt.transactionHash || item.blockHash !== receipt.blockHash || item.blockNumber !== receipt.blockNumber || indices.has(item.logIndex)) throw new Error('Lifecycle receipt log provenance mismatch.');
          indices.add(item.logIndex);
        }
        const included = receipt.logs.find((item) => item.logIndex === log.logIndex);
        if (!included || included.address !== log.address || included.data !== log.data || included.topics.join() !== log.topics.join()) throw new Error('Lifecycle event is absent from its receipt.');
        // Detect omitted same-payment events inside a returned receipt as well.
        const relevant = receipt.logs.filter((item) => item.address === vault && signatures.has(item.topics[0]) && item.topics[1] === proof.messageId);
        if (relevant.some((item) => !logs.some((candidate) => candidate.transactionHash === item.transactionHash && candidate.logIndex === item.logIndex))) throw new Error('Lifecycle history omitted receipt events.');
        const b = await header(destination, log);
        if (b.timestamp < mint.timestamp || b.timestamp > head.timestamp) throw new Error('Lifecycle event clock is outside the observation.');
        const anchor: LifecycleAnchor = { transactionHash: log.transactionHash, blockNumber: log.blockNumber, blockHash: log.blockHash, logIndex: log.logIndex, timestamp: b.timestamp };
        if (name === 'ReturnRequested') {
          if (returnRequest || args.recipient !== proof.payment?.returnRecipient || args.readyAt !== input.returnAt || args.readyAt !== b.timestamp + input.recoveryDelay) throw new Error('Return request differs from customer credit.');
          returnRequest = { ...anchor, readyAt: args.readyAt };
        } else {
          const kind = name === 'ReleaseExecuted' ? 'paid' : 'returned';
          const recipient = kind === 'paid' ? args.to : args.recipient;
          if (outcome || args.amount !== proof.amount || recipient !== (kind === 'paid' ? proof.recipient : proof.payment?.returnRecipient)) throw new Error('Payment disposition conflicts with authenticated credit.');
          outcome = { ...anchor, kind };
        }
      }
      if ((input.returnAt > 0n) !== Boolean(returnRequest) || terminal !== Boolean(outcome) ||
        (outcome?.kind === 'paid' && (input.state !== 'EXECUTED' || input.returnAt > 0n)) ||
        (outcome?.kind === 'returned' && (input.state !== 'RETURNED' || !returnRequest || outcome.timestamp < returnRequest.readyAt ||
          outcome.blockNumber < returnRequest.blockNumber || (outcome.blockNumber === returnRequest.blockNumber && outcome.logIndex <= returnRequest.logIndex)))) throw new Error('Lifecycle receipts do not match finalized payment state.');
    }
    // Recheck all claimed blocks after reading history, including their clocks.
    for (const [rpc, anchor, committed] of [[source, burn, true], [destination, mint, true],
      ...(returnRequest ? [[destination, returnRequest, false] as const] : []), ...(outcome ? [[destination, outcome, false] as const] : [])] as const) {
      if ((await header(rpc, anchor, committed)).timestamp !== anchor.timestamp) throw new Error('Lifecycle block clock changed during observation.');
    }
    return { version: 1, status: 'verified', burn, mint, ...(returnRequest ? { returnRequest } : {}), ...(outcome ? { outcome } : {}) };
  } catch (error) {
    if (error instanceof FinalityConflictError) throw error;
    // Never leak arbitrary RPC text or substitute cached terminal receipts.
    return { version: 1, status: 'unavailable', reason: 'Receipt-backed lifecycle unavailable or inconsistent. State getters alone do not establish its timing or terminal transaction.' };
  }
}
