// Read all authorization facts at one hash-checked block; never mix policy versions.
import { z } from 'zod';
import { cctpAddressSchema, cctpPaymentIntentSchema } from '../../../src/chains/evm/cctp.js';
import { blockHashSchema, blockHeaderSchema } from '../finality.js';
import type { ReleaseStatus } from '../operator.js';
import type { SourceProof } from '../sourceProof.js';
import { releaseTuple } from './releaseState.js';

const uint = z.bigint().nonnegative().max((1n << 256n) - 1n);
export const paymentPolicyTuple = z.tuple([uint.positive(), uint, uint, uint.max(30n * 86400n)])
  .refine(([max, manual, delay]) => manual <= max && delay <= max, 'Invalid customer thresholds.');
export const paymentCreditTuple = z.tuple([cctpAddressSchema, blockHashSchema, blockHashSchema, uint, z.boolean()]);
export const paymentStatusSchema = z.object({
  version: uint.positive(), hash: blockHashSchema, reviewedVersion: uint,
  returnAt: uint, returned: z.boolean(), now: uint,
  blockers: z.array(z.enum(['paused', 'recipient', 'amount', 'approval'])).max(4),
}).strict();
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export class PaymentStateBehindError extends Error {}
export async function readPaymentState(reader: {
  getBlock(args: { blockTag: 'latest' | 'finalized' } | { blockNumber: bigint }): Promise<unknown>;
  read(name: string, block: bigint, args?: readonly string[]): Promise<unknown>;
  minimumBlock(): bigint;
}, messageId: string, proof: SourceProof | undefined, tag: 'latest' | 'finalized' = 'latest'): Promise<ReleaseStatus> {
  if (proof && (!proof.payment || proof.messageId !== messageId)) throw new Error('Authenticated customer payment proof is malformed.');
  const head = blockHeaderSchema.parse(await reader.getBlock({ blockTag: tag }));
  if (head.number < reader.minimumBlock() || (proof && head.number < proof.destination.blockNumber)) throw new PaymentStateBehindError('Customer policy RPC is behind observed settlement/transactions.');
  const read = (name: string, args?: readonly string[]) => reader.read(name, head.number, args);
  const r = releaseTuple.parse(await read('releases', [messageId]));
  const credit = paymentCreditTuple.parse(await read('credits', [messageId]));
  cctpPaymentIntentSchema.parse({ recipient: r[0], returnRecipient: credit[0], operationId: credit[1], policyHash: credit[2] });
  if ((proof?.payment && (credit[0] !== proof.payment.returnRecipient || credit[1] !== proof.payment.operationId || credit[2] !== proof.payment.policyHash ||
    r[0] !== proof.recipient || r[1] !== proof.amount)) || (credit[4] && (r[2] !== 3 || credit[3] === 0n))) {
    throw new Error('On-chain customer credit differs from authenticated intent or terminal state.');
  }
  const [max, manual] = paymentPolicyTuple.parse(await read('paymentPolicy'));
  const version = uint.positive().parse(await read('policyVersion')), hash = blockHashSchema.parse(await read('policyHash'));
  const approved = uint.parse(await read('approvedPolicyVersion', [messageId]));
  const reviewedVersion = uint.parse(await read('reviewedPolicyVersion', [messageId]));
  if (approved > version || reviewedVersion > version || /^0x0{64}$/.test(hash)) throw new Error('Customer policy versions or hash are inconsistent.');
  const paused = z.boolean().parse(await read('paymentsPaused'));
  const allowed = z.boolean().parse(await read('permittedRecipients', [r[0]]));
  const customerDelay = uint.parse(await read('paymentDelayUntil', [messageId]));
  const guardianDelay = uint.parse(await read('releaseDelayUntil', [messageId]));
  const blockers: PaymentStatus['blockers'] = [];
  if (paused) blockers.push('paused');
  if (!allowed) blockers.push('recipient');
  if (r[1] > max) blockers.push('amount');
  if ((r[1] > manual || credit[2] !== hash) && approved !== version) blockers.push('approval');
  const checked = blockHeaderSchema.parse(await reader.getBlock({ blockNumber: head.number }));
  if (checked.number !== head.number || checked.hash !== head.hash || checked.timestamp !== head.timestamp) throw new Error('Customer policy block changed while reading.');
  return { recipient: r[0], amount: r[1], state: r[2], nonce: r[5],
    delay: { until: customerDelay > guardianDelay ? customerDelay : guardianDelay, now: head.timestamp },
    payment: { version, hash, reviewedVersion, returnAt: credit[3], returned: credit[4], now: head.timestamp, blockers } };
}
