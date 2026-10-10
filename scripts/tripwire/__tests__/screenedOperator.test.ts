// H4c3b (ADR-048): the operator against the compiled screened escrow.
// Screening vectors at the operator boundary: format-4 reviews, head relay,
// outages, contradictions retained in the journal, advisory consent (S23),
// returns (S26) and restart/crash reconciliation (S28).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, keccak256, parseTransaction, stringToHex, type Hex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { ReleaseState } from '../operator.js';
import { MATCHED, NOT_LISTED, SCREENED_ROUTE, SCREENING_ISSUER, UNKNOWN } from '../screenedLocal.js';
import { ResponseTier } from '../../../src/tripwire/onChain.js';
import { screenedOperatorFixture } from './fixtures/screenedOperator.js';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const c of cleanups.splice(0).reverse()) c(); });
async function setup() {
  const f = await screenedOperatorFixture(); cleanups.push(f.cleanup);
  const o = f.open(); cleanups.push(o.close);
  return { f, o };
}
const names = (f: { calls: { functionName: string; ok: boolean }[] }) => f.calls.map((c) => `${c.functionName}:${c.ok ? 'ok' : 'reverted'}`);
const args = (f: { vault: { abi: readonly unknown[] } }, raw: Hex) =>
  decodeFunctionData({ abi: f.vault.abi as never, data: parseTransaction(raw).data as Hex }).args as readonly unknown[];

describe('screened operator: the gate in front of every ALLOW', () => {
  it('relays the issuer head, journals evidence before signing, reviews in format 4 and pays once', async () => {
    const { f, o } = await setup();
    const head = await f.answerWith([NOT_LISTED]);
    const before = await f.balance(f.release.recipient);
    // Nothing is signed before the provider's original envelopes are journaled.
    const save = o.store.saveTransaction.bind(o.store);
    const order = vi.spyOn(o.store, 'saveTransaction').mockImplementation((tx) => {
      expect(o.store.screeningRecords(f.id).some((r) => r.kind === 'evidence')).toBe(true); save(tx);
    });
    expect((await o.operator.tick())[0].action).toBe('executed');
    order.mockRestore();
    expect(names(f)).toEqual(['registerScreeningHead:ok', 'reviewScreenedRelease:ok', 'executeRelease:ok']);
    expect(await f.activeHead()).toBe(head.hash);
    expect(await f.balance(f.release.recipient) - before).toBe(f.release.amount);
    const [evidence, result] = o.store.screeningRecords(f.id);
    expect(evidence).toMatchObject({ kind: 'evidence', evidence: { status: 'available', head: head.envelope } });
    expect(result).toMatchObject({ kind: 'result', status: 'verified', outcome: 'NOT_LISTED', headHash: head.hash });
    // Legacy mode keeps the aggregate attestor; the outcome is recorded once.
    expect(f.attestations.length).toBeGreaterThan(0);
    expect(o.store.outcomes()).toEqual([expect.objectContaining({ action: 'executed' })]);
    expect(await o.operator.tick()).toEqual([]);
  });

  it('uses an already active head without relaying it, and the review never outlives the receipt', async () => {
    const { f, o } = await setup();
    const head = await f.signedHead(); await f.registerHead();
    const receipt = await f.signedReceipt(head.hash, { validUntil: f.vm.now + 60n });
    f.knobs.answer = async () => ({ status: 'available', head: head.envelope, receipts: [receipt.envelope] });
    expect((await o.operator.tick())[0].action).toBe('executed');
    expect(names(f)).toEqual(['reviewScreenedRelease:ok', 'executeRelease:ok']);
    const review = args(f, f.calls[0].raw);
    expect(review[2]).toBe(f.vm.now + 60n); // validUntil capped at the receipt's expiry
    expect(review[5]).toMatchObject({ headHash: head.hash, outcome: NOT_LISTED });
  });

  it.each([['MATCHED', MATCHED], ['UNKNOWN', UNKNOWN]] as const)('holds an authenticated %s without signing a review (S02)', async (label, outcome) => {
    const { f, o } = await setup();
    await f.answerWith([outcome]);
    expect((await o.operator.tick())[0]).toMatchObject({ action: 'held', reason: `Screening: ${label}.` });
    expect(names(f)).toEqual(['registerScreeningHead:ok']);
    expect(await f.state()).toBe(ReleaseState.PENDING);
  });

  it.each([
    ['missing', async () => ({ status: 'missing' as const }), 'missing'],
    ['a typed outage', async () => ({ status: 'provider-unavailable' as const }), 'provider-unavailable'],
    ['a thrown error', async () => { throw new Error('https://provider.invalid/?key=PRIVATE_SENTINEL'); }, 'provider-unavailable'],
    ['a malformed answer', async () => ({ status: 'available' as const, head: 'garbage', receipts: [] }), 'invalid-input'],
  ])('holds on %s and journals it without free text (S03)', async (_label, answer, reason) => {
    const { f, o } = await setup();
    await f.registerHead();
    f.knobs.answer = answer as typeof f.knobs.answer;
    expect((await o.operator.tick())[0]).toMatchObject({ action: 'held', reason: `Screening: ${reason}.` });
    expect(f.calls).toEqual([]);
    expect(JSON.stringify(o.store.screeningRecords())).not.toContain('PRIVATE_SENTINEL');
    expect(o.store.screeningRecords(f.id).at(-1)).toMatchObject({ kind: 'result', status: 'unavailable', reason });
  });

  it('refuses an expired receipt, another payment\'s receipt, and a rolled-back head (S07, S09, S12)', async () => {
    const { f, o } = await setup();
    const old = await f.signedHead({ listAsOf: f.vm.now - 500n });
    await f.registerHead({ listAsOf: f.vm.now - 500n });
    const expired = await f.signedReceipt(old.hash, { checkedAt: f.vm.now - 400n, validUntil: f.vm.now - 100n });
    f.knobs.answer = async () => ({ status: 'available', head: old.envelope, receipts: [expired.envelope] });
    expect((await o.operator.tick())[0].reason).toBe('Screening: expired.');
    const elsewhere = await f.signedReceipt(old.hash, { paymentContextHash: keccak256(stringToHex('another payment')) });
    f.knobs.answer = async () => ({ status: 'available', head: old.envelope, receipts: [elsewhere.envelope] });
    expect((await o.operator.tick())[0].reason).toBe('Screening: scope-mismatch.');
    // A newer head is active; the provider's older one is never relayed back.
    await f.registerHead({ revision: 2n, snapshotDigest: keccak256(stringToHex('snapshot-2')) });
    const clean = await f.signedReceipt(old.hash);
    f.knobs.answer = async () => ({ status: 'available', head: old.envelope, receipts: [clean.envelope] });
    expect((await o.operator.tick())[0].reason).toBe('Screening: head-mismatch.');
    expect(f.calls).toEqual([]);
  });

  it('holds when no gate is configured, even with clean evidence', async () => {
    const f = await screenedOperatorFixture(); cleanups.push(f.cleanup);
    const o = f.open({ gate: false }); cleanups.push(o.close);
    await f.answerWith([NOT_LISTED]);
    expect((await o.operator.tick())[0]).toMatchObject({ action: 'held', reason: 'Screening gate is not configured.' });
    expect(f.calls).toEqual([]); expect(f.provider.requests).toEqual([]);
  });
});

describe('screened operator: contradictions are retained, never "newest wins" (S14)', () => {
  it('holds a contradictory batch, keeps holding on a later clean receipt, and resumes only under a new head', async () => {
    const { f, o } = await setup();
    const head = await f.answerWith([MATCHED, NOT_LISTED]);
    expect((await o.operator.tick())[0].reason).toBe('Screening: contradictory.');
    expect(o.store.screeningRecords(f.id).filter((r) => r.kind === 'incident')).toHaveLength(1);
    await f.answerWith([NOT_LISTED], head);
    expect((await o.operator.tick())[0].reason).toBe('Screening: contradictory.');
    expect(o.store.screeningRecords(f.id).filter((r) => r.kind === 'incident')).toHaveLength(1);
    expect(f.calls.filter((c) => c.functionName !== 'registerScreeningHead')).toEqual([]);
    // Resolution: the issuer publishes a new head; a clean receipt under it pays.
    const next = await f.signedHead({ revision: 2n, snapshotDigest: keccak256(stringToHex('snapshot-2')) });
    await f.answerWith([NOT_LISTED], next);
    expect((await o.operator.tick())[0].action).toBe('executed');
    expect(await f.activeHead()).toBe(next.hash);
  });

  it('treats differing outcomes across evaluations of one head and payment as a contradiction', async () => {
    const { f, o } = await setup();
    const head = await f.answerWith([UNKNOWN]);
    expect((await o.operator.tick())[0].reason).toBe('Screening: UNKNOWN.');
    await f.answerWith([NOT_LISTED], head);
    expect((await o.operator.tick())[0].reason).toBe('Screening: contradictory.');
    expect(o.store.screeningRecords(f.id).find((r) => r.kind === 'incident')).toMatchObject({ outcomes: ['UNKNOWN', 'NOT_LISTED'] });
    expect(await f.state()).toBe(ReleaseState.PENDING);
  });

  it('revokes an included ALLOW with a zero-commitment HOLD when the evidence turns contradictory (S25)', async () => {
    const { f, o } = await setup();
    const head = await f.answerWith([NOT_LISTED]);
    f.knobs.executable = false;
    expect((await o.operator.tick())[0].action).toBe('delayed');
    expect(await f.state()).toBe(ReleaseState.VERIFIED);
    await f.answerWith([MATCHED], head);
    expect((await o.operator.tick())[0]).toMatchObject({ action: 'held', reason: 'Screening: contradictory.' });
    expect(names(f).slice(-1)).toEqual(['reviewRelease:ok']);
    expect(await f.state()).toBe(ReleaseState.HELD);
    expect(await f.vm.readContract(f.vault, 'screened', [f.id])).toEqual([`0x${'0'.repeat(64)}`, `0x${'0'.repeat(64)}`, 0n]);
  });
});

describe('screened operator: customer state the screening cannot override', () => {
  it('holds without asking the provider once the customer revokes the profile', async () => {
    const { f, o } = await setup();
    await f.answerWith([NOT_LISTED]);
    expect((await f.vm.sendContract(f.vault, actors.owner, 'revokeScreeningProfile', [])).ok).toBe(true);
    // Revocation commits a new policy, so the intent also needs fresh approval.
    expect((await o.operator.tick())[0]).toMatchObject({ action: 'held', reason: 'Customer payment policy: approval, screening' });
    expect(f.provider.requests).toEqual([]); expect(f.calls).toEqual([]);
  });

  it('holds when the guardian oracle is rotated into the issuer (S16/S18)', async () => {
    const { f, o } = await setup();
    await f.answerWith([NOT_LISTED]);
    expect((await f.vm.send(actors.owner, 'proposeOracle', [SCREENING_ISSUER.address])).ok).toBe(true);
    f.vm.warp(2n * 86_400n);
    expect((await f.vm.send(actors.relayer, 'acceptOracle', [])).ok).toBe(true);
    expect((await o.operator.tick())[0]).toMatchObject({ action: 'held', reason: 'Customer payment policy: screening' });
    expect(f.provider.requests).toEqual([]);
    expect(f.calls.filter((c) => c.functionName.startsWith('review'))).toEqual([]);
  });

  it('completes a matured fixed return without any screening evidence (S26)', async () => {
    const { f, o } = await setup();
    f.knobs.answer = async () => ({ status: 'provider-unavailable' });
    expect((await f.requestReturn()).ok).toBe(true);
    f.vm.warp(3600n);
    expect((await o.operator.tick())[0].action).toBe('returned');
    expect(names(f)).toEqual(['executeReturn:ok']); expect(f.provider.requests).toEqual([]);
  });
});

describe('screened operator: advisory consent (S23)', () => {
  it('holds on a missing baseline in legacy mode, then pays after on-chain consent without the aggregate attestor', async () => {
    const { f, o } = await setup();
    f.knobs.baseline = false;
    await f.answerWith([NOT_LISTED]);
    expect((await o.operator.tick())[0].action).toBe('held');
    expect(f.provider.requests).toEqual([]); // a legacy heuristic HOLD never reaches the gate
    const attested = f.attestations.length;
    expect(attested).toBeGreaterThan(0);
    await f.consentAdvisory(); await f.approve();
    await f.answerWith([NOT_LISTED]); // a fresh head: the first one expired during the queue
    expect((await o.operator.tick())[0].action).toBe('executed');
    expect(f.attestations).toHaveLength(attested);
    const review = f.calls.find((c) => c.functionName === 'reviewScreenedRelease');
    expect(args(f, review!.raw)[1]).toBe(0); // minimum tier NONE: no heuristic picks a guardian tier
  });

  it('lets a high heuristic score raise route protection in legacy mode, but never in advisory mode', async () => {
    // Legacy: score 0.85 attests DELAY on the route and binds it as the review's minimum tier.
    const legacy = await setup();
    legacy.f.knobs.outlier = true;
    await legacy.f.answerWith([NOT_LISTED]);
    expect((await legacy.o.operator.tick())[0].action).toBe('executed');
    expect(Number(await legacy.f.vm.read('currentTier', [SCREENED_ROUTE]))).toBe(ResponseTier.DELAY);
    expect(args(legacy.f, legacy.f.calls.find((c) => c.functionName === 'reviewScreenedRelease')!.raw)[1]).toBe(ResponseTier.DELAY);
    // Advisory: the same indicators are reported, nothing is attested, the review asks for NONE.
    const advisory = await setup();
    advisory.f.knobs.outlier = true;
    await advisory.f.consentAdvisory(); await advisory.f.approve();
    await advisory.f.answerWith([NOT_LISTED]);
    expect((await advisory.o.operator.tick())[0].action).toBe('executed');
    expect(advisory.f.attestations).toEqual([]);
    expect(Number(await advisory.f.vm.read('currentTier', [SCREENED_ROUTE]))).toBe(ResponseTier.NONE);
    expect(args(advisory.f, advisory.f.calls.find((c) => c.functionName === 'reviewScreenedRelease')!.raw)[1]).toBe(ResponseTier.NONE);
  });

  it('still requires a NOT_LISTED receipt in advisory mode', async () => {
    const { f, o } = await setup();
    await f.consentAdvisory(); await f.approve();
    await f.answerWith([MATCHED]);
    expect((await o.operator.tick())[0]).toMatchObject({ action: 'held', reason: 'Screening: MATCHED.' });
    expect(f.attestations).toEqual([]);
  });

  it('rejects a failed source proof in advisory mode with zero screening commitments and no attestation', async () => {
    const { f, o } = await setup();
    await f.consentAdvisory(); await f.approve();
    f.knobs.source = 'invalid';
    expect((await o.operator.tick())[0].action).toBe('rejected');
    expect(names(f)).toEqual(['reviewRelease:ok']);
    expect(args(f, f.calls[0].raw)[1]).toBe(2); // REJECT
    expect(await f.state()).toBe(ReleaseState.REJECTED);
    expect(f.provider.requests).toEqual([]); expect(f.attestations).toEqual([]);
  });
});

describe('screened operator: restart and crash reconciliation (S28)', () => {
  it.each(['before', 'after'] as const)('replays the journaled review after a crash %s broadcast and pays exactly once', async (phase) => {
    const f = await screenedOperatorFixture(); cleanups.push(f.cleanup);
    let o = f.open();
    const head = await f.signedHead(); await f.registerHead();
    await f.answerWith([NOT_LISTED], head);
    f.knobs.crash = phase;
    const before = await f.balance(f.release.recipient);
    await o.operator.tick().catch(() => null);
    const review = o.store.transactions().find((t) => t.id.startsWith('review/'));
    expect(review).toBeDefined();
    const evidence = o.store.screeningRecords(f.id);
    o.close();
    o = f.open(); cleanups.push(o.close);
    // The journal survives: same evidence, same signed review bytes.
    expect(o.store.screeningRecords(f.id).slice(0, evidence.length)).toEqual(evidence);
    expect(o.store.transaction(review!.id)?.raw).toBe(review!.raw);
    const results = await o.operator.tick();
    expect(results[0]?.action ?? 'executed').toBe('executed');
    expect(f.calls.filter((c) => c.raw === review!.raw)).toHaveLength(1);
    expect(f.calls.filter((c) => c.functionName === 'executeRelease' && c.ok)).toHaveLength(1);
    expect(await f.balance(f.release.recipient) - before).toBe(f.release.amount);
    expect(o.store.outcomes()).toEqual([expect.objectContaining({ action: 'executed' })]);
    expect(await o.operator.tick()).toEqual([]);
  });

  it('replays a journaled head relay after a crash and never relays it twice', async () => {
    const f = await screenedOperatorFixture(); cleanups.push(f.cleanup);
    let o = f.open();
    const head = await f.answerWith([NOT_LISTED]);
    f.knobs.crash = 'before';
    await o.operator.tick().catch(() => null);
    expect(o.store.transactions().map((t) => t.id)).toEqual([`screening-head/${head.hash}`]);
    o.close();
    o = f.open(); cleanups.push(o.close);
    expect((await o.operator.tick())[0].action).toBe('executed');
    expect(names(f)).toEqual(['registerScreeningHead:ok', 'reviewScreenedRelease:ok', 'executeRelease:ok']);
    expect(o.store.transactions().filter((t) => t.id.startsWith('screening-head/'))).toHaveLength(1);
  });

  it('keeps a retained contradiction across a restart', async () => {
    const f = await screenedOperatorFixture(); cleanups.push(f.cleanup);
    let o = f.open();
    const head = await f.answerWith([MATCHED, NOT_LISTED]);
    expect((await o.operator.tick())[0].reason).toBe('Screening: contradictory.');
    o.close();
    o = f.open(); cleanups.push(o.close);
    await f.answerWith([NOT_LISTED], head);
    expect((await o.operator.tick())[0].reason).toBe('Screening: contradictory.');
    expect(await f.state()).toBe(ReleaseState.PENDING);
  });
});
