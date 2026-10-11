// H4c2 acceptance vectors S01–S16 (ADR-045). Synthetic fixture keys only.
// Digests are rebuilt by hand from raw 32-byte ABI words and the EIP-712
// 0x1901 prefix, independently of the implementation's viem encoders.
import { describe, expect, it, vi } from 'vitest';
import { concat, keccak256, numberToHex, pad, stringToHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { screeningEvidenceSchema } from '../../../domain/screening.js';
import { screeningHeadTransition, verifyScreeningEvidence } from '../screening.js';

const key = (label: string) => privateKeyToAccount(keccak256(stringToHex(`tripwire-screening-fixture/${label}`)));
const issuer = key('issuer'), oracle = key('oracle'), authority = key('authority'), stranger = key('stranger');
const word = (value: bigint | number) => pad(numberToHex(BigInt(value)), { size: 32 });
const addr = (value: Hex) => pad(value.toLowerCase() as Hex, { size: 32 });
const id = (label: string) => keccak256(stringToHex(label));
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const scope = { destinationChainId: '11155111', vault: '0x00000000000000000000000000000000000000a1', guardian: '0x00000000000000000000000000000000000000a2',
  routeId: id('route'), token: '0x00000000000000000000000000000000000000a3' };
const profile = { version: 1, providerIdHash: id('provider'), listIdHash: id('list'), issuer: issuer.address, subject: 'payout-recipient',
  maxObservationAgeSeconds: '300', maxSnapshotAgeSeconds: '3600' };
const context = { ...scope, sourceSender: '0x00000000000000000000000000000000000000b1', policyVersion: '3', policyHash: id('policy'),
  messageId: id('message'), operationId: id('operation'), recipient: '0x00000000000000000000000000000000000000b2', amount: '999901',
  returnRecipient: '0x00000000000000000000000000000000000000b3', intentPolicyHash: id('intent') };
const roles = { oracle: oracle.address, authority: authority.address };

// Independent vectors: abi.encode of static values is concatenated 32-byte words.
const profileHash = (s = scope, p = profile) => keccak256(concat([id('Tripwire/Screening/profile/v1'), word(BigInt(s.destinationChainId)),
  addr(s.vault as Hex), addr(s.guardian as Hex), s.routeId as Hex, addr(s.token as Hex), p.providerIdHash as Hex, p.listIdHash as Hex,
  addr(p.issuer as Hex), word(0), word(BigInt(p.maxObservationAgeSeconds)), word(BigInt(p.maxSnapshotAgeSeconds))]));
const contextHash = (c = context) => keccak256(concat([id('Tripwire/Screening/payment/v1'), word(BigInt(c.destinationChainId)),
  addr(c.vault as Hex), addr(c.guardian as Hex), c.routeId as Hex, addr(c.token as Hex), addr(c.sourceSender as Hex), word(BigInt(c.policyVersion)),
  c.policyHash as Hex, c.messageId as Hex, c.operationId as Hex, addr(c.recipient as Hex), word(BigInt(c.amount)), addr(c.returnRecipient as Hex),
  c.intentPolicyHash as Hex]));
const domainSeparator = (s = scope) => keccak256(concat([
  id('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
  id('TripwireScreening'), id('1'), word(BigInt(s.destinationChainId)), addr(s.vault as Hex)]));
const typed = (structHash: Hex, s = scope) => keccak256(concat(['0x1901', domainSeparator(s), structHash]));

interface HeadFields { profileHash: Hex; revision: bigint; snapshotDigest: Hex; listAsOf: bigint; validUntil: bigint }
interface ReceiptFields { profileHash: Hex; headHash: Hex; paymentContextHash: Hex; outcome: number; checkedAt: bigint; validUntil: bigint }
const headDigest = (h: HeadFields, s = scope) => typed(keccak256(concat([
  id('ScreeningHead(bytes32 profileHash,uint64 revision,bytes32 snapshotDigest,uint64 listAsOf,uint64 validUntil)'),
  h.profileHash, word(h.revision), h.snapshotDigest, word(h.listAsOf), word(h.validUntil)])), s);
const receiptDigest = (r: ReceiptFields, s = scope) => typed(keccak256(concat([
  id('ScreeningReceipt(bytes32 profileHash,bytes32 headHash,bytes32 paymentContextHash,uint8 outcome,uint64 checkedAt,uint64 validUntil)'),
  r.profileHash, r.headHash, r.paymentContextHash, word(r.outcome), word(r.checkedAt), word(r.validUntil)])), s);
const text = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]));

const LIST_AS_OF = 1_780_000_000n;
const NOT_LISTED = 1, MATCHED = 2, UNKNOWN = 0;
async function signedHead(over: Partial<HeadFields> = {}, signer = issuer, s = scope) {
  const head: HeadFields = { profileHash: profileHash(s), revision: 1n, snapshotDigest: id('snapshot-1'), listAsOf: LIST_AS_OF,
    validUntil: LIST_AS_OF + 3600n, ...over };
  const hash = headDigest(head, s);
  return { head, hash, envelope: { version: 1, head: text(head), signature: await signer.sign({ hash }) } };
}
async function signedReceipt(headHash: Hex, over: Partial<ReceiptFields> = {}, signer = issuer, s = scope) {
  const receipt: ReceiptFields = { profileHash: profileHash(s), headHash, paymentContextHash: contextHash(), outcome: NOT_LISTED,
    checkedAt: LIST_AS_OF + 100n, validUntil: LIST_AS_OF + 400n, ...over };
  const hash = receiptDigest(receipt, s);
  return { receipt, hash, envelope: { version: 1, receipt: text(receipt), signature: await signer.sign({ hash }) } };
}
async function verify(o: { receipts?: unknown[]; head?: Awaited<ReturnType<typeof signedHead>>; now?: bigint;
  activeHeadHash?: Hex; context?: object; scope?: object; profile?: object; roles?: object } = {}) {
  const head = o.head ?? await signedHead();
  const receipts = o.receipts ?? [(await signedReceipt(head.hash)).envelope];
  return verifyScreeningEvidence({ scope: o.scope ?? scope, profile: o.profile ?? profile, roles: o.roles ?? roles,
    activeHeadHash: o.activeHeadHash ?? head.hash, paymentContext: o.context ?? context, now: (o.now ?? LIST_AS_OF + 110n).toString(),
    evidence: { status: 'available', head: head.envelope, receipts } });
}
const unavailable = (reason: string) => ({ status: 'unavailable', reason, authorization: 'none' });
/** Flip one byte of a signature's r value. */
const corrupt = (sig: string) => `${sig.slice(0, 10)}${sig[10] === '0' ? '1' : '0'}${sig.slice(11)}`;

describe('screening evidence verifier (H4c2)', () => {
  it('S01 verifies an exact NOT_LISTED receipt for the active head, with independent digests and no authorization', async () => {
    const head = await signedHead(), receipt = await signedReceipt(head.hash);
    const now = vi.spyOn(Date, 'now');
    const result = await verify({ head, receipts: [receipt.envelope] });
    expect(now).not.toHaveBeenCalled(); now.mockRestore();
    expect(result).toEqual({ status: 'verified', outcome: 'NOT_LISTED', authorization: 'none', listAsOf: LIST_AS_OF,
      checkedAt: LIST_AS_OF + 100n, receiptValidUntil: LIST_AS_OF + 400n, headValidUntil: LIST_AS_OF + 3600n, revision: 1n,
      evaluatedAt: LIST_AS_OF + 110n, profileHash: profileHash(), headHash: head.hash, receiptHash: receipt.hash,
      paymentContextHash: contextHash(), receipts: 1, provenance: 'caller-supplied-scope' });
    expect(screeningEvidenceSchema.parse(result)).toEqual(result);
    for (const field of ['decision', 'allow', 'score', 'tier', 'signature', 'minimumTier'])
      expect(Object.keys(result)).not.toContain(field);
  });

  it.each([[MATCHED, 'MATCHED'], [UNKNOWN, 'UNKNOWN']])('S02 reports outcome %i as verified %s, never as a pass', async (outcome, name) => {
    const head = await signedHead();
    const result = await verify({ head, receipts: [(await signedReceipt(head.hash, { outcome })).envelope] });
    expect(result).toMatchObject({ status: 'verified', outcome: name, authorization: 'none' });
  });

  it('S03 turns absence and typed provider outage into fixed unavailable results', async () => {
    const base = { scope, profile, roles, activeHeadHash: id('x'), paymentContext: context, now: '1' };
    expect(await verifyScreeningEvidence({ ...base, evidence: { status: 'missing' } })).toEqual(unavailable('missing'));
    expect(await verifyScreeningEvidence({ ...base, evidence: { status: 'provider-unavailable' } })).toEqual(unavailable('provider-unavailable'));
    expect(await verify({ receipts: [] })).toEqual(unavailable('missing'));
    expect(await verifyScreeningEvidence({ ...base, evidence: { status: 'timeout' } as never })).toEqual(unavailable('invalid-input'));
  });

  it('S04 refuses unknown versions, fields, enums, floats, overflow, non-canonical integers, zero IDs and bad checksums', async () => {
    const head = await signedHead(), receipt = await signedReceipt(head.hash);
    expect(await verify({ head, receipts: [{ ...receipt.envelope, version: 2 }] })).toEqual(unavailable('unsupported-version'));
    expect(await verify({ head, profile: { ...profile, version: 2 } })).toEqual(unavailable('unsupported-version'));
    const r = receipt.envelope.receipt;
    for (const bad of [{ ...r, extra: '1' }, { ...r, outcome: 3 }, { ...r, outcome: '1' }, { ...r, checkedAt: '1.5' },
      { ...r, checkedAt: '18446744073709551616' }, { ...r, checkedAt: '01' }, { ...r, checkedAt: ' 1' }, { ...r, checkedAt: 1 },
      { ...r, headHash: `0x${'0'.repeat(64)}` }]) {
      expect(await verify({ head, receipts: [{ ...receipt.envelope, receipt: bad }] })).toEqual(unavailable('invalid-input'));
    }
    for (const bad of [{ ...context, messageId: `0x${'0'.repeat(64)}` }, { ...context, amount: '0' }, { ...context, recipient: `0x${'0'.repeat(40)}` },
      { ...context, recipient: '0x00000000000000000000000000000000000000B2'.replace('0x0000', '0xAbCd') }, { ...context, unknown: 1 }]) {
      expect(await verify({ head, context: bad })).toEqual(unavailable('invalid-input'));
    }
    expect(await verify({ head, profile: { ...profile, maxObservationAgeSeconds: '29' } })).toEqual(unavailable('invalid-input'));
    expect(await verify({ head, profile: { ...profile, maxSnapshotAgeSeconds: '86401' } })).toEqual(unavailable('invalid-input'));
    expect(await verify({ head, profile: { ...profile, maxObservationAgeSeconds: '600', maxSnapshotAgeSeconds: '599' } })).toEqual(unavailable('invalid-input'));
    expect(await verify({ head, profile: { ...profile, subject: 'source-sender' } })).toEqual(unavailable('invalid-input'));
  });

  it('S05 refuses a wrong signer, high-s, bad v or length, and fields changed after signing', async () => {
    const head = await signedHead(), good = await signedReceipt(head.hash);
    expect(await verify({ head, receipts: [(await signedReceipt(head.hash, {}, stranger)).envelope] })).toEqual(unavailable('invalid-signature'));
    const sig = good.envelope.signature, s = BigInt(`0x${sig.slice(66, 130)}`), v = Number.parseInt(sig.slice(130), 16);
    const highS = `${sig.slice(0, 66)}${(N - s).toString(16).padStart(64, '0')}${(v === 27 ? 28 : 27).toString(16)}`;
    expect(await verify({ head, receipts: [{ ...good.envelope, signature: highS }] })).toEqual(unavailable('invalid-signature'));
    for (const badV of ['00', '01', '1d']) {
      expect(await verify({ head, receipts: [{ ...good.envelope, signature: `${sig.slice(0, 130)}${badV}` }] })).toEqual(unavailable('invalid-signature'));
    }
    expect(await verify({ head, receipts: [{ ...good.envelope, signature: sig.slice(0, 130) }] })).toEqual(unavailable('invalid-input'));
    expect(await verify({ head, receipts: [{ ...good.envelope, signature: corrupt(sig) }] })).toEqual(unavailable('invalid-signature'));
    const flipped = { ...good.envelope, receipt: { ...good.envelope.receipt, outcome: MATCHED } };
    expect(await verify({ head, receipts: [flipped] })).toEqual(unavailable('invalid-signature'));
    const forgedHead = await signedHead({}, stranger);
    expect(await verify({ head: forgedHead, receipts: [(await signedReceipt(forgedHead.hash)).envelope] })).toEqual(unavailable('invalid-signature'));
  });

  it('S06 refuses another chain, vault, route, token or guardian', async () => {
    for (const field of ['destinationChainId', 'vault', 'guardian', 'routeId', 'token'] as const) {
      const value = field === 'destinationChainId' ? '84532' : field === 'routeId' ? id('other-route') : '0x00000000000000000000000000000000000000c1';
      // The payment belongs elsewhere than the evaluated scope.
      expect(await verify({ context: { ...context, [field]: value } })).toEqual(unavailable('scope-mismatch'));
      // Evidence signed for this scope, evaluated for another: its profile and domain no longer match.
      const other = { ...scope, [field]: value };
      expect(await verify({ scope: other, context: { ...context, [field]: value } })).toMatchObject({ status: 'unavailable', authorization: 'none' });
    }
  });

  it.each(['sourceSender', 'operationId', 'messageId', 'recipient', 'amount', 'returnRecipient'] as const)(
    'S07 refuses a receipt moved to a different %s', async (field) => {
      const value = field === 'amount' ? '999902' : field.endsWith('Id') ? id(`other-${field}`) : '0x00000000000000000000000000000000000000d1';
      expect(await verify({ context: { ...context, [field]: value } })).toEqual(unavailable('scope-mismatch'));
    });

  it.each([['policyVersion', '4'], ['policyHash', id('policy-2')], ['intentPolicyHash', id('intent-2')]] as const)(
    'S08 refuses a receipt after the customer %s changed', async (field, value) => {
      expect(await verify({ context: { ...context, [field]: value } })).toEqual(unavailable('scope-mismatch'));
    });

  it('S09 accepts exact expiry and maximum ages, and refuses one second later', async () => {
    const head = await signedHead(), receipt = await signedReceipt(head.hash, { checkedAt: LIST_AS_OF + 100n, validUntil: LIST_AS_OF + 400n });
    expect(await verify({ head, receipts: [receipt.envelope], now: LIST_AS_OF + 400n })).toMatchObject({ status: 'verified' });
    expect(await verify({ head, receipts: [receipt.envelope], now: LIST_AS_OF + 401n })).toEqual(unavailable('expired'));
    // Snapshot age: the head's last valid second, with a receipt that reaches it.
    const late = await signedReceipt(head.hash, { checkedAt: LIST_AS_OF + 3300n, validUntil: LIST_AS_OF + 3600n });
    expect(await verify({ head, receipts: [late.envelope], now: LIST_AS_OF + 3600n })).toMatchObject({ status: 'verified' });
    expect(await verify({ head, receipts: [late.envelope], now: LIST_AS_OF + 3601n })).toEqual(unavailable('expired'));
  });

  it('S10 refuses future snapshots and observations and impossible clock orders, with no local-clock tolerance', async () => {
    const head = await signedHead(), receipt = await signedReceipt(head.hash);
    expect(await verify({ head, receipts: [receipt.envelope], now: LIST_AS_OF + 99n })).toEqual(unavailable('future'));
    expect(await verify({ head, receipts: [receipt.envelope], now: LIST_AS_OF - 1n })).toEqual(unavailable('future'));
    expect(await verify({ head, receipts: [(await signedReceipt(head.hash, { checkedAt: LIST_AS_OF - 1n, validUntil: LIST_AS_OF + 10n })).envelope] }))
      .toEqual(unavailable('invalid-input'));
    expect(await verify({ head, receipts: [(await signedReceipt(head.hash, { checkedAt: LIST_AS_OF + 100n, validUntil: LIST_AS_OF + 99n })).envelope] }))
      .toEqual(unavailable('invalid-input'));
  });

  it('S11 refuses a receipt that outlives its observation age or its head, and a head that outlives its snapshot age', async () => {
    const head = await signedHead();
    expect(await verify({ head, receipts: [(await signedReceipt(head.hash, { validUntil: LIST_AS_OF + 401n })).envelope] })).toEqual(unavailable('invalid-input'));
    const short = await signedHead({ validUntil: LIST_AS_OF + 200n });
    expect(await verify({ head: short, receipts: [(await signedReceipt(short.hash)).envelope] })).toEqual(unavailable('invalid-input'));
    const long = await signedHead({ validUntil: LIST_AS_OF + 3601n });
    expect(await verify({ head: long, receipts: [(await signedReceipt(long.hash)).envelope] })).toEqual(unavailable('invalid-input'));
  });

  it('S12 refuses a head rollback, a different head at the same revision and an older snapshot under a newer revision', async () => {
    const first = await signedHead({ revision: 2n });
    const transition = (previous: unknown, next: unknown, now = LIST_AS_OF + 10n) =>
      screeningHeadTransition({ scope, profile, previous, next, now: now.toString() });
    expect(await transition(null, first.envelope)).toEqual({ status: 'accepted', headHash: first.hash, authorization: 'none' });
    expect(await transition(first.envelope, (await signedHead({ revision: 1n })).envelope)).toEqual(unavailable('head-mismatch'));
    expect(await transition(first.envelope, (await signedHead({ revision: 2n, snapshotDigest: id('snapshot-other') })).envelope))
      .toEqual(unavailable('contradictory'));
    expect(await transition(first.envelope, (await signedHead({ revision: 3n, listAsOf: LIST_AS_OF - 1n, validUntil: LIST_AS_OF + 3000n })).envelope))
      .toEqual(unavailable('invalid-input'));
    const next = await signedHead({ revision: 3n, snapshotDigest: id('snapshot-3'), listAsOf: LIST_AS_OF + 5n, validUntil: LIST_AS_OF + 3605n });
    expect(await transition(first.envelope, next.envelope)).toEqual({ status: 'accepted', headHash: next.hash, authorization: 'none' });
    expect(await transition(first.envelope, next.envelope, LIST_AS_OF + 4n)).toEqual(unavailable('future'));
    expect(await transition(first.envelope, next.envelope, LIST_AS_OF + 3606n)).toEqual(unavailable('expired'));
    expect(await transition(first.envelope, (await signedHead({ revision: 3n }, stranger)).envelope)).toEqual(unavailable('invalid-signature'));
  });

  it('S13 is idempotent for a repeated head or receipt and never refreshes original times', async () => {
    const head = await signedHead(), receipt = await signedReceipt(head.hash);
    expect(await screeningHeadTransition({ scope, profile, previous: head.envelope, next: head.envelope, now: (LIST_AS_OF + 10n).toString() }))
      .toEqual({ status: 'unchanged', headHash: head.hash, authorization: 'none' });
    const once = await verify({ head, receipts: [receipt.envelope] });
    const twice = await verify({ head, receipts: [receipt.envelope, receipt.envelope, structuredClone(receipt.envelope)] });
    expect(twice).toEqual(once);
    const later = await verify({ head, receipts: [receipt.envelope], now: LIST_AS_OF + 300n });
    expect(later).toMatchObject({ status: 'verified', checkedAt: LIST_AS_OF + 100n, receiptValidUntil: LIST_AS_OF + 400n, evaluatedAt: LIST_AS_OF + 300n });
    // Two distinct signed observations with one outcome: the earlier expiry is reported, never a mix of the two.
    const second = await signedReceipt(head.hash, { checkedAt: LIST_AS_OF + 105n, validUntil: LIST_AS_OF + 390n });
    expect(await verify({ head, receipts: [receipt.envelope, second.envelope] })).toMatchObject({ status: 'verified',
      checkedAt: LIST_AS_OF + 105n, receiptValidUntil: LIST_AS_OF + 390n, receiptHash: second.hash, receipts: 2 });
  });

  it.each([[MATCHED, NOT_LISTED], [UNKNOWN, NOT_LISTED], [NOT_LISTED, MATCHED]])(
    'S14 treats outcomes %i and %i for one head and payment as contradictory, in any order', async (a, b) => {
      const head = await signedHead();
      const first = await signedReceipt(head.hash, { outcome: a }), second = await signedReceipt(head.hash, { outcome: b, checkedAt: LIST_AS_OF + 101n });
      expect(await verify({ head, receipts: [first.envelope, second.envelope] })).toEqual(unavailable('contradictory'));
      expect(await verify({ head, receipts: [second.envelope, first.envelope] })).toEqual(unavailable('contradictory'));
    });

  it('S15 refuses the whole batch for one invalid item or more than eight receipts', async () => {
    const head = await signedHead(), good = await signedReceipt(head.hash);
    const forged = (await signedReceipt(head.hash, { checkedAt: LIST_AS_OF + 102n }, stranger)).envelope;
    expect(await verify({ head, receipts: [good.envelope, forged] })).toEqual(unavailable('invalid-signature'));
    expect(await verify({ head, receipts: [good.envelope, { version: 1 }] })).toEqual(unavailable('invalid-input'));
    const many = await Promise.all(Array.from({ length: 9 }, (_, i) => signedReceipt(head.hash, { checkedAt: LIST_AS_OF + 100n + BigInt(i) })));
    expect(await verify({ head, receipts: many.map((r) => r.envelope) })).toEqual(unavailable('invalid-input'));
    expect(await verify({ head, receipts: many.slice(0, 8).map((r) => r.envelope) })).toMatchObject({ status: 'verified', receipts: 8 });
  });

  it.each(['oracle', 'authority'] as const)('S16 refuses an issuer that is also the current %s', async (role) => {
    expect(await verify({ roles: { ...roles, [role]: issuer.address } })).toEqual(unavailable('issuer-conflict'));
  });

  it('refuses a head that is not the active one and a receipt bound to an older head or another profile', async () => {
    const head = await signedHead(), other = await signedHead({ revision: 2n, snapshotDigest: id('snapshot-2') });
    expect(await verify({ head, activeHeadHash: other.hash })).toEqual(unavailable('head-mismatch'));
    expect(await verify({ head, receipts: [(await signedReceipt(other.hash)).envelope] })).toEqual(unavailable('head-mismatch'));
    expect(await verify({ head, receipts: [(await signedReceipt(head.hash, { profileHash: id('other-profile') })).envelope] }))
      .toEqual(unavailable('profile-mismatch'));
    expect(await verify({ head, profile: { ...profile, listIdHash: id('other-list') } })).toEqual(unavailable('profile-mismatch'));
  });

  it('matches the independent vectors for the profile, context, head and receipt digests', async () => {
    const head = await signedHead(), receipt = await signedReceipt(head.hash);
    const result = await verify({ head, receipts: [receipt.envelope] });
    expect(result).toMatchObject({ profileHash: profileHash(), paymentContextHash: contextHash(), headHash: head.hash, receiptHash: receipt.hash });
  });
});
