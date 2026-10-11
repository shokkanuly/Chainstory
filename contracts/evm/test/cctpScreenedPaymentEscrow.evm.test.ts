// H4c3a: the screened payment escrow (ADR-047) on a local EVM. Acceptance
// vectors S12–S27 from the H4c1 policy that a contract can decide. Operator-side
// vectors (S23, S28) belong to H4c3b. Synthetic keys and fixtures only.
import { describe, expect, it } from 'vitest';
import { keccak256, stringToHex, zeroAddress, type Hex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { screeningPaymentContextHash } from '../../../src/chains/evm/screening.js';
import { ReleaseDecision } from '../../../scripts/tripwire/review.js';
import { PAYMENT_NET } from '../../../scripts/tripwire/paymentLocal.js';
import { DAY, LOCAL_PROFILE, MATCHED, SCREENING_ISSUER, SCREENING_STRANGER, UNKNOWN, deployScreenedEscrow, screenedLocalFixture } from '../../../scripts/tripwire/screenedLocal.js';

describe('screened payment escrow: happy path and codec agreement', () => {
  it('pays only after an issuer-signed NOT_LISTED receipt and a format-4 review', async () => {
    const f = await screenedLocalFixture();
    expect(await f.vm.readContract(f.vault, 'REVIEW_FORMAT_VERSION')).toBe(4n);
    // Contract and the H4c2 TypeScript codec agree on every screening digest.
    expect(await f.vm.readContract(f.vault, 'screeningProfileHash')).toBe(f.profileHash());
    expect(await f.vm.readContract(f.vault, 'paymentContextHash', [f.id])).toBe(screeningPaymentContextHash(await f.context()));
    const result = await f.allow();
    expect(result).toMatchObject({ ok: true });
    expect((await f.execute()).ok).toBe(true);
    expect(await f.vm.readContract(f.token, 'balanceOf', [actors.attacker.address])).toBe(PAYMENT_NET);
  });
});

describe('screened payment escrow: deployment', () => {
  it.each([
    ['issuer is the oracle', { issuer: actors.oracle.address }],
    ['issuer is the customer authority', { issuer: actors.owner.address }],
    ['zero issuer', { issuer: zeroAddress }],
    ['zero provider', { providerIdHash: `0x${'0'.repeat(64)}` }],
    ['zero list', { listIdHash: `0x${'0'.repeat(64)}` }],
    ['observation age below 30 s', { maxObservationAgeSeconds: 29 }],
    ['observation age above 600 s', { maxObservationAgeSeconds: 601 }],
    ['snapshot age above a day', { maxSnapshotAgeSeconds: 86_401 }],
    ['snapshot age below observation age', { maxObservationAgeSeconds: 600, maxSnapshotAgeSeconds: 599 }],
  ] as const)('S16/S04 refuses an unsafe profile: %s', async (_name, over) => {
    const f = await screenedLocalFixture({ register: false });
    await expect(deployScreenedEscrow(f.vm, f.token.address, f.transmitter.address, { ...LOCAL_PROFILE, ...over } as typeof LOCAL_PROFILE))
      .rejects.toThrow('InvalidScreeningProfile');
  });

  it('starts paused in legacy mode with no head, and a v2 policy hash', async () => {
    const f = await screenedLocalFixture({ register: false });
    const fresh = await deployScreenedEscrow(f.vm, f.token.address, f.transmitter.address);
    expect(await f.vm.readContract(fresh, 'paymentsPaused')).toBe(true);
    expect(await f.vm.readContract(fresh, 'executionMode')).toBe(0);
    expect((await f.vm.readContract<[Hex]>(fresh, 'activeHead'))[0]).toBe(`0x${'0'.repeat(64)}`);
    expect(await f.vm.readContract(fresh, 'SCREENING_ESCROW_VERSION')).toBe(2n);
  });

  it('refuses a v1 payment hook: a v1 credit can never be reinterpreted here', async () => {
    const f = await screenedLocalFixture();
    const v1 = f.message({ nonce: `0x${'0'.repeat(63)}2`, operationId: keccak256(stringToHex('second')) });
    const tampered = `${v1.slice(0, 2 + 376 * 2)}${keccak256(stringToHex('Tripwire/CCTP/v2/USDC/payment/v1')).slice(2)}${v1.slice(2 + 408 * 2)}` as Hex;
    expect((await f.receive(tampered)).error).toBe('UnsupportedCctpMessage');
  });
});

describe('screened payment escrow: list heads (S12, S13)', () => {
  it('accepts the issuer\'s head once and treats a repeat as a no-op', async () => {
    const f = await screenedLocalFixture({ register: false });
    const first = await f.registerHead();
    expect(first.ok).toBe(true); expect(await f.activeHead()).toBe(first.hash);
    f.vm.warp(60n);
    const again = await f.registerHead({ listAsOf: first.head.listAsOf });
    expect(again.ok).toBe(true); expect(await f.activeHead()).toBe(first.hash);
    const stored = await f.vm.readContract<[Hex, bigint, bigint, bigint]>(f.vault, 'activeHead');
    expect(stored[3]).toBe(first.head.validUntil); // Never extended.
  });
  it('refuses a stranger, a conflict, a rollback, an older snapshot, the wrong clock and an over-long head', async () => {
    const f = await screenedLocalFixture({ register: false });
    expect((await f.registerHead({}, SCREENING_STRANGER)).error).toBe('InvalidIssuerSignature');
    const base = await f.registerHead({ revision: 5n });
    expect(base.ok).toBe(true);
    expect((await f.registerHead({ revision: 5n, snapshotDigest: keccak256(stringToHex('other')) })).error).toBe('ScreeningHeadConflict');
    expect((await f.registerHead({ revision: 4n, snapshotDigest: keccak256(stringToHex('older')) })).error).toBe('ScreeningHeadRollback');
    expect((await f.registerHead({ revision: 6n, listAsOf: base.head.listAsOf - 1n })).error).toBe('ScreeningHeadRollback');
    expect((await f.registerHead({ revision: 6n, listAsOf: f.vm.now + 10n })).error).toBe('ScreeningHeadOutOfTime');
    expect((await f.registerHead({ revision: 6n, listAsOf: f.vm.now, validUntil: f.vm.now + 3601n })).error).toBe('InvalidScreeningHead');
    f.vm.warp(3601n);
    expect((await f.registerHead({ revision: 6n, listAsOf: base.head.listAsOf })).error).toBe('ScreeningHeadOutOfTime');
    expect((await f.registerHead({ revision: 6n })).ok).toBe(true);
  });
});

describe('screened payment escrow: review gate (S21, S20, S05–S11)', () => {
  it('S21 refuses a reviewer ALLOW without the issuer\'s receipt, on chain', async () => {
    const f = await screenedLocalFixture();
    expect((await f.plainReview(ReleaseDecision.ALLOW)).error).toBe('ScreeningProofRequired');
    // A reviewer that invents commitments still needs a real issuer receipt.
    const forged = await f.receipt({}, SCREENING_STRANGER);
    expect((await f.allow(forged)).error).toBe('InvalidIssuerSignature');
    expect((await f.execute()).error).toBe('ReleaseNotReviewed');
  });
  it.each([[MATCHED, 'MATCHED'], [UNKNOWN, 'UNKNOWN']] as const)('refuses outcome %i (%s) for ALLOW', async (outcome) => {
    const f = await screenedLocalFixture();
    expect((await f.allow(await f.receipt({ outcome }))).error).toBe('ScreeningNotCleared');
  });
  it('refuses a receipt for another payment, another head or another profile', async () => {
    const f = await screenedLocalFixture();
    expect((await f.allow(await f.receipt({ paymentContextHash: keccak256(stringToHex('another payment')) }))).error).toBe('ScreeningWrongPayment');
    expect((await f.allow(await f.receipt({ headHash: keccak256(stringToHex('old head')) }))).error).toBe('ScreeningNotActive');
    expect((await f.allow(await f.receipt({ profileHash: keccak256(stringToHex('other profile')) }))).error).toBe('ScreeningNotActive');
  });
  it('S09/S10/S11 enforces receipt clocks: exact expiry is valid, one second later is not', async () => {
    const f = await screenedLocalFixture();
    const r = await f.receipt();
    expect((await f.allow(await f.receipt({ checkedAt: f.vm.now + 1n, validUntil: f.vm.now + 2n }))).error).toBe('ScreeningOutOfTime');
    expect((await f.allow(await f.receipt({ validUntil: f.vm.now + 301n }))).error).toBe('ScreeningOutOfTime');
    expect((await f.allow(await f.receipt({ checkedAt: f.vm.now - 1n }))).error).toBe('ScreeningOutOfTime');
    f.vm.warp(301n);
    expect((await f.allow(r)).error).toBe('ScreeningOutOfTime');
  });
  it('refuses a review that would outlive its receipt', async () => {
    const f = await screenedLocalFixture();
    const r = await f.receipt({ validUntil: f.vm.now + 100n });
    expect((await f.allow(r, { validUntil: f.vm.now + 101n })).error).toBe('ReviewOutlivesScreening');
    expect((await f.allow(r, { validUntil: f.vm.now + 100n })).ok).toBe(true);
  });
  it('S20 refuses a review signed over other screening commitments or in the old format', async () => {
    const f = await screenedLocalFixture();
    const r = await f.receipt();
    expect((await f.allow(r, {}, f.id, { receiptHash: keccak256(stringToHex('other')), headHash: r.fields.headHash, validUntil: r.fields.validUntil })).error)
      .toBe('InvalidReviewer');
    const { signPaymentReleaseReview } = await import('../../../scripts/tripwire/review.js');
    const review = await f.reviewData();
    const old = await signPaymentReleaseReview(actors.oracle, f.vault.address, review, await f.policy(), 31337);
    expect((await f.vm.sendContract(f.vault, actors.relayer, 'reviewScreenedRelease',
      [f.id, review.minimumTier, review.validUntil, review.nonce, old, r.fields, r.signature])).error).toBe('InvalidReviewer');
  });
  it('S05 refuses a high-s or malformed issuer signature', async () => {
    const f = await screenedLocalFixture();
    const r = await f.receipt();
    const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const s = BigInt(`0x${r.signature.slice(66, 130)}`), v = Number.parseInt(r.signature.slice(130), 16);
    const highS = `${r.signature.slice(0, 66)}${(N - s).toString(16).padStart(64, '0')}${(v === 27 ? 28 : 27).toString(16)}` as Hex;
    expect((await f.allow({ ...r, signature: highS })).error).toMatch(/ECDSAInvalidSignatureS|InvalidIssuerSignature/);
    expect((await f.allow({ ...r, signature: r.signature.slice(0, 130) as Hex })).error).toMatch(/ECDSAInvalidSignatureLength|InvalidIssuerSignature/);
  });
});

describe('screened payment escrow: execution recheck (S17, S18, S19, S22, S24, S25)', () => {
  it('S17 a newer head after ALLOW blocks execution until fresh evidence and a fresh review', async () => {
    const f = await screenedLocalFixture();
    expect((await f.allow()).ok).toBe(true);
    f.vm.warp(10n);
    expect((await f.registerHead({ revision: 2n, snapshotDigest: keccak256(stringToHex('snapshot-2')) })).ok).toBe(true);
    expect((await f.execute()).error).toBe('StaleScreening');
    expect((await f.allow()).ok).toBe(true);
    expect((await f.execute()).ok).toBe(true);
  });
  it('S18 revoking the profile refuses execution and every new receipt until a profile is re-applied', async () => {
    const f = await screenedLocalFixture();
    expect((await f.allow()).ok).toBe(true);
    expect((await f.vm.sendContract(f.vault, actors.owner, 'revokeScreeningProfile', [])).ok).toBe(true);
    expect((await f.execute()).error).toMatch(/StalePaymentReview|StaleScreening/);
    expect((await f.registerHead({ revision: 2n })).error).toBe('ScreeningRevoked');
    expect((await f.vm.sendContract(f.vault, actors.relayer, 'applyScreeningProfile', [LOCAL_PROFILE])).error).toBe('PolicyChangeNotReady');
    expect((await f.vm.sendContract(f.vault, actors.owner, 'scheduleScreeningProfile', [LOCAL_PROFILE])).ok).toBe(true);
    f.vm.warp(DAY);
    expect((await f.vm.sendContract(f.vault, actors.relayer, 'applyScreeningProfile', [LOCAL_PROFILE])).ok).toBe(true);
    expect((await f.allow()).error).toBe('ScreeningNotActive'); // No head until the issuer publishes one.
    expect((await f.registerHead({ revision: 1n })).ok).toBe(true);
    // The intent was committed under an older policy, so the customer approves again, as for any policy change.
    expect((await f.vm.sendContract(f.vault, actors.owner, 'approvePayment', [f.id])).ok).toBe(true);
    expect((await f.allow()).ok).toBe(true);
    expect((await f.execute()).ok).toBe(true);
  });
  it('S18 an oracle rotated into the issuer makes screening unusable; a rotated oracle voids the old ALLOW', async () => {
    const f = await screenedLocalFixture();
    expect((await f.allow()).ok).toBe(true);
    await f.vm.send(actors.owner, 'proposeOracle', [SCREENING_ISSUER.address]);
    f.vm.warp(2n * DAY); await f.vm.send(actors.relayer, 'acceptOracle', []);
    // The rotation's 2-day notice outlives any review (600 s at most), so the old ALLOW is already void.
    expect((await f.execute()).error).toMatch(/ReviewExpired|InvalidReviewer|ScreeningIssuerConflict/);
    expect((await f.registerHead({ revision: 2n, listAsOf: f.vm.now })).error).toBe('ScreeningIssuerConflict');
    expect((await f.allow()).error).toBe('ScreeningIssuerConflict');
  });
  it('S19 an older ALLOW cannot land after a newer HOLD', async () => {
    const f = await screenedLocalFixture();
    const r = await f.receipt(); const stale = await f.reviewData();
    expect((await f.plainReview(ReleaseDecision.HOLD, f.id, { nonce: stale.nonce + 1n })).ok).toBe(true);
    expect((await f.allow(r, { nonce: stale.nonce })).error).toBe('ReviewNonceAlreadyUsed');
    expect((await f.execute()).error).toBe('ReleaseHeld');
  });
  it('S22 valid screening does not override customer policy: a revoked recipient or a pause blocks payout', async () => {
    const f = await screenedLocalFixture();
    expect((await f.allow()).ok).toBe(true);
    expect((await f.vm.sendContract(f.vault, actors.owner, 'pausePayments', [])).ok).toBe(true);
    expect((await f.execute()).error).toMatch(/StalePaymentReview|PaymentsPaused/);
    const g = await screenedLocalFixture();
    expect((await g.allow()).ok).toBe(true);
    expect((await g.vm.sendContract(g.vault, actors.owner, 'revokeRecipient', [actors.attacker.address])).ok).toBe(true);
    expect((await g.execute()).error).toMatch(/StalePaymentReview|RecipientNotPermitted/);
  });
  it('S24 a receipt that expires during the customer delay needs fresh evidence; the delay itself is not reset', async () => {
    const f = await screenedLocalFixture({ amount: 6_000_000n }); // Above the approval and delay thresholds.
    expect((await f.vm.sendContract(f.vault, actors.owner, 'approvePayment', [f.id])).ok).toBe(true);
    expect((await f.allow()).ok).toBe(true);
    const until = await f.vm.readContract<bigint>(f.vault, 'paymentDelayUntil', [f.id]);
    expect(until).toBe(f.vm.now + 1800n);
    expect((await f.execute()).error).toMatch(/PaymentDelayActive/);
    f.vm.warp(1800n);
    expect((await f.execute()).error).toBe('ReviewExpired');
    expect((await f.registerHead({ revision: 2n, snapshotDigest: keccak256(stringToHex('snapshot-2')) })).ok).toBe(true);
    expect((await f.allow()).ok).toBe(true);
    expect(await f.vm.readContract(f.vault, 'paymentDelayUntil', [f.id])).toBe(until);
    expect((await f.execute()).ok).toBe(true);
  });
  it('S25 an included ALLOW stays bounded by its own expiry; the contract cannot see a later provider outage', async () => {
    const f = await screenedLocalFixture();
    expect((await f.allow(await f.receipt({ validUntil: f.vm.now + 60n }), { validUntil: f.vm.now + 60n })).ok).toBe(true);
    f.vm.warp(61n);
    expect((await f.execute()).error).toMatch(/ReviewExpired|StaleScreening/);
  });
});

describe('screened payment escrow: outages, returns and consent (S03, S26, S27)', () => {
  it('S03 HOLD and REJECT need no receipt, so an outage never blocks a revocation', async () => {
    const f = await screenedLocalFixture({ register: false });
    expect((await f.plainReview(ReleaseDecision.HOLD)).ok).toBe(true);
    expect((await f.plainReview(ReleaseDecision.REJECT)).ok).toBe(true);
    expect((await f.execute()).error).toBe('ReleaseRejected');
  });
  it('S26 a paused escrow and a revoked recipient still let the mature fixed return through, with no payout', async () => {
    const f = await screenedLocalFixture();
    await f.vm.sendContract(f.vault, actors.owner, 'pausePayments', []);
    await f.vm.sendContract(f.vault, actors.owner, 'revokeRecipient', [actors.attacker.address]);
    expect((await f.requestReturn()).ok).toBe(true);
    f.vm.warp(3600n);
    expect((await f.executeReturn()).ok).toBe(true);
    expect(await f.vm.readContract(f.token, 'balanceOf', [actors.attacker.address])).toBe(0n);
    expect(await f.vm.readContract(f.vault, 'totalReturned')).toBe(PAYMENT_NET);
  });
  it('S27 advisory mode is consent through the one-day queue; early, wrong or stranger actions refuse', async () => {
    const f = await screenedLocalFixture();
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'scheduleExecutionMode', [1])).error).toBe('OnlyPolicyAuthority');
    const before = await f.vm.readContract<bigint>(f.vault, 'policyVersion');
    expect((await f.vm.sendContract(f.vault, actors.owner, 'scheduleExecutionMode', [1])).ok).toBe(true);
    expect((await f.vm.sendContract(f.vault, actors.relayer, 'applyExecutionMode', [1])).error).toBe('PolicyChangeNotReady');
    f.vm.warp(DAY);
    expect((await f.vm.sendContract(f.vault, actors.relayer, 'applyExecutionMode', [0])).error).toBe('PolicyChangeNotReady');
    expect((await f.vm.sendContract(f.vault, actors.relayer, 'applyExecutionMode', [1])).ok).toBe(true);
    expect(await f.vm.readContract(f.vault, 'executionMode')).toBe(1);
    expect(await f.vm.readContract(f.vault, 'policyVersion')).toBe(before + 1n);
    // Consent changes the policy, so an old review cannot carry over; screening stays mandatory.
    expect((await f.plainReview(ReleaseDecision.ALLOW)).error).toBe('ScreeningProofRequired');
  });
});
