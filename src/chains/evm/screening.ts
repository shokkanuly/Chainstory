// Pure screening evidence verifier (H4c2, ADR-045). No network, clock, key,
// storage, review decision or signing: every input, including the destination
// block time, comes from the caller, and the result authorizes nothing.
// The caller's scope, roles, active head and payment context are NOT proven to
// come from canonical chain state here; H4c3 must read them coherently.
import { encodeAbiParameters, hashTypedData, isAddress, keccak256, recoverAddress, stringToHex, type Hex } from 'viem';
import { z } from 'zod';
import {
  screeningUnavailable, type ScreeningEvidence, type ScreeningOutcome, type ScreeningUnavailable, type ScreeningUnavailableReason,
} from '../../domain/screening.js';

/** secp256k1 n / 2: a canonical (low-s) signature never exceeds it. */
const HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
export const MAX_SCREENING_RECEIPTS = 8;
const OUTCOMES: readonly ScreeningOutcome[] = ['UNKNOWN', 'NOT_LISTED', 'MATCHED'];

// Canonical unsigned decimal strings: no sign, exponent, whitespace or leading zero.
const decimal = (min: bigint, max: bigint) => z.string().max(78).regex(/^(0|[1-9][0-9]*)$/)
  .transform((v) => BigInt(v)).refine((v) => v >= min && v <= max, 'Integer out of range.');
const UINT64 = (1n << 64n) - 1n, UINT256 = (1n << 256n) - 1n;
const uint64 = decimal(0n, UINT64), positive64 = decimal(1n, UINT64), positive256 = decimal(1n, UINT256);
/** Strict EVM address: a mixed-case value must carry a valid checksum. Hashed bytes are unchanged. */
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine((v) => isAddress(v, { strict: true }), 'Address checksum is invalid.')
  .transform((v) => v.toLowerCase() as Hex).refine((v) => !/^0x0{40}$/.test(v), 'Zero address.');
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((v) => v.toLowerCase() as Hex)
  .refine((v) => !/^0x0{64}$/.test(v), 'Zero digest.');
const signature = z.string().regex(/^0x[0-9a-fA-F]{130}$/).transform((v) => v.toLowerCase() as Hex);

export const screeningScopeSchema = z.object({
  destinationChainId: positive256, vault: address, guardian: address, routeId: bytes32, token: address,
}).strict();
export const screeningProfileSchema = z.object({
  version: z.literal(1), providerIdHash: bytes32, listIdHash: bytes32, issuer: address, subject: z.literal('payout-recipient'),
  maxObservationAgeSeconds: decimal(30n, 600n), maxSnapshotAgeSeconds: decimal(30n, 86_400n),
}).strict().refine((p) => p.maxSnapshotAgeSeconds >= p.maxObservationAgeSeconds, 'Snapshot age is below observation age.');
export const screeningPaymentContextSchema = z.object({
  destinationChainId: positive256, vault: address, guardian: address, routeId: bytes32, token: address, sourceSender: address,
  policyVersion: positive256, policyHash: bytes32, messageId: bytes32, operationId: bytes32, recipient: address,
  amount: positive256, returnRecipient: address, intentPolicyHash: bytes32,
}).strict();
const headSchema = z.object({ profileHash: bytes32, revision: positive64, snapshotDigest: bytes32, listAsOf: uint64, validUntil: uint64 }).strict();
const receiptSchema = z.object({ profileHash: bytes32, headHash: bytes32, paymentContextHash: bytes32,
  outcome: z.union([z.literal(0), z.literal(1), z.literal(2)]), checkedAt: uint64, validUntil: uint64 }).strict();
export const screeningHeadEnvelopeSchema = z.object({ version: z.literal(1), head: headSchema, signature }).strict();
export const screeningReceiptEnvelopeSchema = z.object({ version: z.literal(1), receipt: receiptSchema, signature }).strict();
const rolesSchema = z.object({ oracle: address, authority: address }).strict();

export type ScreeningScope = z.output<typeof screeningScopeSchema>;
export type ScreeningProfile = z.output<typeof screeningProfileSchema>;
export type ScreeningPaymentContext = z.output<typeof screeningPaymentContextSchema>;
type Head = z.output<typeof headSchema>;
type Receipt = z.output<typeof receiptSchema>;

const PROFILE_NAMESPACE = keccak256(stringToHex('Tripwire/Screening/profile/v1'));
const PAYMENT_NAMESPACE = keccak256(stringToHex('Tripwire/Screening/payment/v1'));
export const SCREENING_TYPES = {
  ScreeningHead: [{ name: 'profileHash', type: 'bytes32' }, { name: 'revision', type: 'uint64' },
    { name: 'snapshotDigest', type: 'bytes32' }, { name: 'listAsOf', type: 'uint64' }, { name: 'validUntil', type: 'uint64' }],
  ScreeningReceipt: [{ name: 'profileHash', type: 'bytes32' }, { name: 'headHash', type: 'bytes32' },
    { name: 'paymentContextHash', type: 'bytes32' }, { name: 'outcome', type: 'uint8' },
    { name: 'checkedAt', type: 'uint64' }, { name: 'validUntil', type: 'uint64' }],
} as const;
const domain = (scope: ScreeningScope) =>
  ({ name: 'TripwireScreening', version: '1', chainId: scope.destinationChainId, verifyingContract: scope.vault }) as const;

/** keccak(abi.encode(...)) of the profile bound to one chain, vault, guardian, route and token. */
export function screeningProfileHash(scope: ScreeningScope, profile: ScreeningProfile): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }, { type: 'address' },
      { type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }, { type: 'uint8' }, { type: 'uint32' }, { type: 'uint32' }],
    [PROFILE_NAMESPACE, scope.destinationChainId, scope.vault, scope.guardian, scope.routeId, scope.token,
      profile.providerIdHash, profile.listIdHash, profile.issuer, 0, Number(profile.maxObservationAgeSeconds), Number(profile.maxSnapshotAgeSeconds)]));
}

/** keccak(abi.encode(...)) of the exact payment: a receipt cannot move to another credit, policy or chain. */
export function screeningPaymentContextHash(c: ScreeningPaymentContext): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }, { type: 'address' },
      { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' },
      { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }],
    [PAYMENT_NAMESPACE, c.destinationChainId, c.vault, c.guardian, c.routeId, c.token, c.sourceSender, c.policyVersion, c.policyHash,
      c.messageId, c.operationId, c.recipient, c.amount, c.returnRecipient, c.intentPolicyHash]));
}

/** The complete EIP-712 signing digest: this, not the snapshot digest, is the head hash. */
export const screeningHeadHash = (scope: ScreeningScope, head: Head): Hex =>
  hashTypedData({ domain: domain(scope), types: SCREENING_TYPES, primaryType: 'ScreeningHead', message: head });
export const screeningReceiptHash = (scope: ScreeningScope, receipt: Receipt): Hex =>
  hashTypedData({ domain: domain(scope), types: SCREENING_TYPES, primaryType: 'ScreeningReceipt', message: receipt });

/** Exactly 65 bytes, v 27/28, nonzero r/s and low-s, recovering the configured issuer. */
async function signedBy(digest: Hex, sig: Hex, issuer: Hex): Promise<boolean> {
  const r = BigInt(`0x${sig.slice(2, 66)}`), s = BigInt(`0x${sig.slice(66, 130)}`), v = Number.parseInt(sig.slice(130), 16);
  if (r === 0n || s === 0n || s > HALF_N || (v !== 27 && v !== 28)) return false;
  try { return (await recoverAddress({ hash: digest, signature: sig })).toLowerCase() === issuer; }
  catch { return false; }
}

const failure = (reason: ScreeningUnavailableReason): never => { throw new ScreeningRefusal(reason); };
class ScreeningRefusal extends Error {
  constructor(readonly reason: ScreeningUnavailableReason) { super(reason); }
}
/** Strict parse; any version other than 1 is unsupported rather than merely malformed. */
function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  if (value && typeof value === 'object' && 'version' in value && (value as { version: unknown }).version !== 1) failure('unsupported-version');
  const result = schema.safeParse(value);
  return result.success ? result.data : failure('invalid-input');
}
async function run<T>(work: () => Promise<T>): Promise<T | ScreeningUnavailable> {
  try { return await work(); }
  catch (error) { if (error instanceof ScreeningRefusal) return screeningUnavailable(error.reason); throw error; }
}

/** Structure, issuer signature and internal clock order of one head, before any freshness or activity check. */
async function checkedHead(scope: ScreeningScope, profile: ScreeningProfile, profileHash: Hex, input: unknown) {
  const envelope = parse(screeningHeadEnvelopeSchema, input);
  const { head } = envelope;
  if (head.profileHash !== profileHash) failure('profile-mismatch');
  if (head.validUntil < head.listAsOf || head.validUntil > head.listAsOf + profile.maxSnapshotAgeSeconds) failure('invalid-input');
  const hash = screeningHeadHash(scope, head);
  if (!(await signedBy(hash, envelope.signature, profile.issuer))) failure('invalid-signature');
  return { head, hash };
}

function headTime(head: Head, profile: ScreeningProfile, now: bigint): void {
  if (head.listAsOf > now) failure('future');
  if (now > head.validUntil || now - head.listAsOf > profile.maxSnapshotAgeSeconds) failure('expired');
}

/**
 * Verify screening evidence for one exact payment against the caller's active
 * head. A batch is all-or-nothing (at most 8 receipts): one invalid item makes
 * the whole batch unavailable; differing authenticated outcomes are
 * contradictory, never "newest wins". Identical receipts deduplicate.
 */
export async function verifyScreeningEvidence(input: {
  scope: unknown; profile: unknown; roles: unknown; activeHeadHash: unknown; paymentContext: unknown; now: unknown;
  evidence: { status: 'missing' } | { status: 'provider-unavailable' } | { status: 'available'; head: unknown; receipts: readonly unknown[] };
}): Promise<ScreeningEvidence> {
  return run(async () => {
    if (input.evidence?.status === 'missing' || input.evidence?.status === 'provider-unavailable') return screeningUnavailable(input.evidence.status);
    if (input.evidence?.status !== 'available' || !Array.isArray(input.evidence.receipts)) return failure('invalid-input');
    const profile = parse(screeningProfileSchema, input.profile);
    const scope = parse(screeningScopeSchema, input.scope);
    const roles = parse(rolesSchema, input.roles);
    const context = parse(screeningPaymentContextSchema, input.paymentContext);
    const activeHeadHash = parse(bytes32, input.activeHeadHash);
    const now = parse(uint64, input.now);
    // The issuer must be independent of whoever reviews or configures the payment.
    if (profile.issuer === roles.oracle || profile.issuer === roles.authority) failure('issuer-conflict');
    if (context.destinationChainId !== scope.destinationChainId || context.vault !== scope.vault || context.guardian !== scope.guardian ||
      context.routeId !== scope.routeId || context.token !== scope.token) failure('scope-mismatch');
    const profileHash = screeningProfileHash(scope, profile);
    const { head, hash: headHash } = await checkedHead(scope, profile, profileHash, input.evidence.head);
    if (headHash !== activeHeadHash) failure('head-mismatch');
    const receiptsIn = input.evidence.receipts;
    if (receiptsIn.length === 0) failure('missing');
    if (receiptsIn.length > MAX_SCREENING_RECEIPTS) failure('invalid-input');
    const paymentContextHash = screeningPaymentContextHash(context);
    const unique = new Map<Hex, Receipt>();
    for (const raw of receiptsIn) {
      const envelope = parse(screeningReceiptEnvelopeSchema, raw);
      const { receipt } = envelope;
      if (receipt.profileHash !== profileHash) failure('profile-mismatch');
      if (receipt.headHash !== headHash) failure('head-mismatch');
      // The payment context is the receipt's scope: another credit, policy or amount is a scope mismatch.
      if (receipt.paymentContextHash !== paymentContextHash) failure('scope-mismatch');
      if (receipt.checkedAt < head.listAsOf || receipt.validUntil < receipt.checkedAt ||
        receipt.validUntil > receipt.checkedAt + profile.maxObservationAgeSeconds || receipt.validUntil > head.validUntil) failure('invalid-input');
      const hash = screeningReceiptHash(scope, receipt);
      if (!(await signedBy(hash, envelope.signature, profile.issuer))) failure('invalid-signature');
      unique.set(hash, receipt);
    }
    // Freshness against the caller's destination block time; equality at a limit is still valid.
    headTime(head, profile, now);
    for (const receipt of unique.values()) {
      if (receipt.checkedAt > now) failure('future');
      if (now > receipt.validUntil || now - receipt.checkedAt > profile.maxObservationAgeSeconds) failure('expired');
    }
    const receipts = [...unique.entries()];
    if (new Set(receipts.map(([, r]) => r.outcome)).size > 1) failure('contradictory');
    // Same outcome, several signed observations: report the one that expires first (deterministic, never a mix).
    const [receiptHash, chosen] = receipts.reduce((a, b) => b[1].validUntil < a[1].validUntil ||
      (b[1].validUntil === a[1].validUntil && b[0] < a[0]) ? b : a);
    return { status: 'verified', outcome: OUTCOMES[chosen.outcome], authorization: 'none', listAsOf: head.listAsOf,
      checkedAt: chosen.checkedAt, receiptValidUntil: chosen.validUntil, headValidUntil: head.validUntil, revision: head.revision,
      evaluatedAt: now, profileHash, headHash, receiptHash, paymentContextHash, receipts: receipts.length,
      provenance: 'caller-supplied-scope' } as const;
  });
}

/**
 * Whether `next` may become the active head after `previous` (explicit input:
 * there is no hidden registry). Re-registering the identical signed head is
 * idempotent and cannot extend its expiry; a rollback, a different head at the
 * same revision, or a newer revision with an earlier snapshot time refuses.
 */
export async function screeningHeadTransition(input: { scope: unknown; profile: unknown; previous: unknown | null; next: unknown; now: unknown }):
  Promise<{ status: 'accepted' | 'unchanged'; headHash: Hex; authorization: 'none' } | ScreeningUnavailable> {
  return run(async () => {
    const profile = parse(screeningProfileSchema, input.profile);
    const scope = parse(screeningScopeSchema, input.scope);
    const now = parse(uint64, input.now);
    const profileHash = screeningProfileHash(scope, profile);
    const next = await checkedHead(scope, profile, profileHash, input.next);
    if (input.previous !== null && input.previous !== undefined) {
      const previous = await checkedHead(scope, profile, profileHash, input.previous);
      if (previous.hash === next.hash) return { status: 'unchanged', headHash: next.hash, authorization: 'none' } as const;
      if (next.head.revision === previous.head.revision) failure('contradictory');
      if (next.head.revision < previous.head.revision) failure('head-mismatch');
      if (next.head.listAsOf < previous.head.listAsOf) failure('invalid-input');
    }
    headTime(next.head, profile, now);
    return { status: 'accepted', headHash: next.hash, authorization: 'none' } as const;
  });
}
