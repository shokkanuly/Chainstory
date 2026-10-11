// Screening facts for one release (H4c3b, ADR-048), read at the SAME
// hash-checked block as the customer payment state: execution mode, the active
// profile and list head, the commitments a past ALLOW stored, the current
// oracle/authority and the exact payment context. The operator never verifies
// a receipt against a head, profile or policy version from another block.
import type { Hex } from 'viem';
import { z } from 'zod';
import { cctpAddressSchema } from '../../../src/chains/evm/cctp.js';
import { screeningPaymentContextHash, screeningProfileHash,
  type ScreeningPaymentContext, type ScreeningProfile, type ScreeningScope } from '../../../src/chains/evm/screening.js';

const uint = z.bigint().nonnegative().max((1n << 256n) - 1n);
const word = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((v) => v.toLowerCase() as Hex);
const address = cctpAddressSchema;
export const ZERO_WORD = `0x${'0'.repeat(64)}` as Hex;

export const screeningStatusSchema = z.object({
  /** On-chain customer consent: LEGACY_ENFORCED keeps behavioral enforcement, ADVISORY_V1 drops it (ADR-045). */
  mode: z.enum(['legacy', 'advisory']),
  /** The escrow's active profile; zero once the customer revoked it. */
  profileHash: word,
  /** Whether the active profile is the one this operator was accepted for. */
  accepted: z.boolean(),
  issuer: address,
  head: z.object({ hash: word, revision: uint, listAsOf: uint, validUntil: uint }).strict(),
  /** What the last ALLOW stored; zero after HOLD/REJECT or before any review. */
  stored: z.object({ receiptHash: word, headHash: word, validUntil: uint }).strict(),
  context: z.object({ destinationChainId: uint, vault: address, guardian: address, routeId: word, token: address, sourceSender: address,
    policyVersion: uint, policyHash: word, messageId: word, operationId: word, recipient: address, amount: uint,
    returnRecipient: address, intentPolicyHash: word }).strict(),
  contextHash: word,
  roles: z.object({ oracle: address, authority: address }).strict(),
  block: z.object({ number: uint, hash: word }).strict(),
  now: uint,
}).strict();
export type ScreeningStatus = z.infer<typeof screeningStatusSchema>;

/**
 * What a keyless report may say about screening (H4c3c): display only, never
 * evidence and never authorization. Whether the escrow could execute the
 * current review is the chain's call; this mirrors its recheck at one block.
 */
export interface PublicScreeningStatus {
  version: 1; mode: 'legacy' | 'advisory'; profile: 'accepted' | 'revoked' | 'other'; issuerIndependent: boolean;
  head: { revision: bigint; listAsOf: bigint; validUntil: bigint; current: boolean } | null;
  allowEvidence: { validUntil: bigint; current: boolean } | null;
  authorization: 'none';
}
export function publicScreeningStatus(s: ScreeningStatus): PublicScreeningStatus {
  const profile = s.accepted ? 'accepted' : s.profileHash === ZERO_WORD ? 'revoked' : 'other';
  const issuerIndependent = s.issuer !== s.roles.oracle && s.issuer !== s.roles.authority;
  const head = s.head.hash === ZERO_WORD ? null : { revision: s.head.revision, listAsOf: s.head.listAsOf, validUntil: s.head.validUntil, current: s.now <= s.head.validUntil };
  const allowEvidence = s.stored.receiptHash === ZERO_WORD ? null : { validUntil: s.stored.validUntil,
    current: profile === 'accepted' && issuerIndependent && head !== null && head.current && s.stored.headHash === s.head.hash && s.now <= s.stored.validUntil };
  return { version: 1, mode: s.mode, profile, issuerIndependent, head, allowEvidence, authorization: 'none' };
}

/** The accepted deployment's screening profile and scope; the oracle read is on the guardian. */
export interface ScreenedReadSpec {
  scope: ScreeningScope;
  profile: ScreeningProfile;
  readOracle(block: bigint): Promise<unknown>;
}

const headTuple = z.tuple([word, uint, uint, uint]);
const storedTuple = z.tuple([word, word, uint]);

/**
 * `read` must be bound to the escrow and to `block`, which the caller
 * hash-checks after this returns (readPaymentState does both).
 */
export async function readScreeningFacts(read: (name: string, args?: readonly string[]) => Promise<unknown>, spec: ScreenedReadSpec, block: bigint, facts: {
  messageId: Hex; blockHash: Hex; now: bigint; recipient: Hex; amount: bigint;
  policy: { version: bigint; hash: Hex }; credit: { returnRecipient: Hex; operationId: Hex; intentPolicyHash: Hex };
}): Promise<{ screening: ScreeningStatus; blocked: boolean }> {
  const mode = z.number().int().min(0).max(1).parse(Number(z.union([z.number(), z.bigint()]).parse(await read('executionMode'))));
  const profileHash = word.parse(await read('screeningProfileHash'));
  const [headHash, revision, listAsOf, headValidUntil] = headTuple.parse(await read('activeHead'));
  const [receiptHash, storedHead, storedUntil] = storedTuple.parse(await read('screened', [facts.messageId]));
  const onChainContext = word.parse(await read('paymentContextHash', [facts.messageId]));
  const authority = address.parse(await read('policyAuthority'));
  const sourceSender = address.parse(await read('authorizedSourceSender'));
  const oracle = address.parse(await spec.readOracle(block));
  const context: ScreeningPaymentContext = { ...spec.scope, sourceSender, policyVersion: facts.policy.version, policyHash: facts.policy.hash,
    messageId: facts.messageId, operationId: facts.credit.operationId, recipient: address.parse(facts.recipient) as Hex, amount: facts.amount,
    returnRecipient: address.parse(facts.credit.returnRecipient) as Hex, intentPolicyHash: facts.credit.intentPolicyHash };
  const contextHash = screeningPaymentContextHash(context);
  // The escrow computes the same binding itself: a mismatch means a wrong codec or a mixed read, never a hold.
  if (contextHash !== onChainContext) throw new Error('Screening payment context differs from the escrow\'s own binding. Reconcile.');
  const accepted = profileHash === screeningProfileHash(spec.scope, spec.profile);
  const issuer = spec.profile.issuer;
  const screening = screeningStatusSchema.parse({ mode: mode === 1 ? 'advisory' : 'legacy', profileHash, accepted, issuer,
    head: { hash: headHash, revision, listAsOf, validUntil: headValidUntil },
    stored: { receiptHash, headHash: storedHead, validUntil: storedUntil },
    context, contextHash, roles: { oracle, authority }, block: { number: block, hash: facts.blockHash }, now: facts.now });
  // No evidence can clear these; a missing or old head can be, by relaying a newer one.
  // A revoked profile (zero hash) is never the accepted one.
  const blocked = !accepted || issuer === oracle || issuer === authority;
  return { screening, blocked };
}
