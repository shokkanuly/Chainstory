import { z } from 'zod';
import { eventOriginSchema } from './events.js';
import { blockHashSchema } from './finality.js';
import { cctpPaymentIntentSchema } from '../../src/chains/evm/cctp.js';

const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const origin = eventOriginSchema.extend({ blockNumber: z.union([z.bigint(), decimal.transform(BigInt)]).pipe(z.bigint().nonnegative()) });
export const sourceVerifierScopeSchema = z.object({
  kind: z.literal('cctp-v2-usdc'), fingerprint: blockHashSchema,
  settlement: z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((v) => v.toLowerCase()),
  /** Customer payment profiles carry an authenticated intent; the screened one uses the v2 hook (ADR-048). */
  profile: z.enum(['customer-payment-v1', 'customer-payment-screened-v1']).optional(),
}).strict();
export const sourceProofSchema = z.object({
  messageId: blockHashSchema,
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((v) => v.toLowerCase()),
  amount: z.union([z.bigint(), decimal.transform(BigInt)]).pipe(z.bigint().positive()),
  nonce: blockHashSchema.refine((s) => !/^0x0{64}$/.test(s), 'Zero source nonce.'),
  source: origin, destination: origin, sourceMessageHash: blockHashSchema, destinationBodyHash: blockHashSchema,
  payment: cctpPaymentIntentSchema.optional(),
}).strict();
export type SourceProof = z.output<typeof sourceProofSchema>;
export const proofPosition = (origin: SourceProof['source']) => `${origin.chainId}/${origin.address}/${origin.transactionHash}/${origin.logIndex}`;
