import { describe, expect, it } from 'vitest';
import { hashTypedData, keccak256, toHex, type Hex } from 'viem';
import guardianArtifact from '../../../src/tripwire/guardian.artifact.js';
import { GuardianVM, LOCAL_CHAIN_ID, actors } from '../../../src/tripwire/guardianVM.js';
import demo from '../../../scripts/tripwire/testnet/contracts.artifact.js';
import { RELEASE_REVIEW_TYPES, ReleaseDecision, signReleaseReview, type ReleaseReview } from '../../../scripts/tripwire/review.js';
import { ResponseTier, signAttestation } from '../../../src/tripwire/onChain.js';

const ROUTE = keccak256(toHex('release-safety-test'));
const MESSAGE = keccak256(toHex('pending-release'));
const AMOUNT = 40_000n * 10n ** 6n;

async function deployReleaseFixture() {
  const vm = await GuardianVM.deploy(guardianArtifact);
  const token = await vm.deployContract(demo.DemoUSDC, [actors.owner.address]);
  const vault = await vm.deployContract(demo.ProtectedVault, [actors.owner.address, token.address, vm.address, ROUTE]);
  expect((await vm.send(actors.owner, 'configureRoute', [ROUTE, 2_000_000n * 10n ** 6n, 3600n])).ok).toBe(true);
  expect((await vm.send(actors.owner, 'setProtected', [vault.address, true])).ok).toBe(true);
  expect((await vm.sendContract(token, actors.owner, 'mint', [vault.address, AMOUNT * 10n])).ok).toBe(true);
  expect((await vm.sendContract(vault, actors.owner, 'requestRelease', [MESSAGE, actors.bridge.address, AMOUNT])).ok).toBe(true);
  return { vm, token, vault };
}

type Fixture = Awaited<ReturnType<typeof deployReleaseFixture>>;
const reviewFor = ({ vm, token }: Fixture, over: Partial<ReleaseReview> = {}): ReleaseReview => ({
  messageId: MESSAGE, routeId: ROUTE, token: token.address, recipient: actors.bridge.address,
  amount: AMOUNT, decision: ReleaseDecision.ALLOW, minimumTier: ResponseTier.NONE, validUntil: vm.now + 300n, nonce: 1n, ...over,
});

async function submit(fixture: Fixture, review = reviewFor(fixture), signature?: Hex) {
  const signed = signature ?? await signReleaseReview(actors.oracle, fixture.vault.address, review, LOCAL_CHAIN_ID);
  return fixture.vm.sendContract(fixture.vault, actors.relayer, 'reviewRelease', [
    review.messageId, review.decision, review.minimumTier, review.validUntil, review.nonce, signed,
  ]);
}

describe('release execution gate', () => {
  it('blocks a payout requested and executed before the watcher reacts', async () => {
    const { vm, token, vault } = await deployReleaseFixture();
    const result = await vm.sendContract(vault, actors.attacker, 'executeRelease', [MESSAGE]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ReleaseNotReviewed');
    expect(await vm.readContract(token, 'balanceOf', [actors.bridge.address])).toBe(0n);
  });

  it('pays a reviewed release exactly once, regardless of who relays it', async () => {
    const f = await deployReleaseFixture();
    expect((await submit(f)).ok).toBe(true);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).ok).toBe(true);
    expect(await f.vm.readContract(f.token, 'balanceOf', [actors.bridge.address])).toBe(AMOUNT);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('AlreadyExecuted');
  });

  it('signs exactly the digest the vault verifies', async () => {
    const f = await deployReleaseFixture();
    const review = reviewFor(f);
    const digest = hashTypedData({
      domain: { name: 'TripwireProtectedVault', version: '1', chainId: LOCAL_CHAIN_ID, verifyingContract: f.vault.address },
      types: RELEASE_REVIEW_TYPES, primaryType: 'ReleaseReview', message: review,
    });
    expect(await f.vm.readContract(f.vault, 'hashReleaseReview', [MESSAGE, review.decision, review.minimumTier, review.validUntil, review.nonce])).toBe(digest);
    // A view must not corrupt the nonce of the subsequent signed owner transaction.
    expect((await f.vm.send(actors.owner, 'setProtected', [actors.bridge.address, true])).ok).toBe(true);
  });

  it.each([
    ['message', { messageId: keccak256(toHex('other-message')) }],
    ['route', { routeId: keccak256(toHex('other-route')) }],
    ['token', { token: actors.attacker.address }],
    ['recipient', { recipient: actors.attacker.address }],
    ['amount', { amount: AMOUNT + 1n }],
    ['decision', { decision: ReleaseDecision.HOLD }],
    ['minimum protection', { minimumTier: ResponseTier.DELAY }],
    ['expiry', { validUntil: 1_780_000_200n }],
    ['nonce', { nonce: 2n }],
  ] satisfies Array<[string, Partial<ReleaseReview>]>)('rejects a signature for a different %s', async (_name, over) => {
    const f = await deployReleaseFixture();
    const forged = await signReleaseReview(actors.oracle, f.vault.address, reviewFor(f, over), LOCAL_CHAIN_ID);
    expect((await submit(f, reviewFor(f), forged)).error).toBe('InvalidReviewer');
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('ReleaseNotReviewed');
  });

  it.each(['chain', 'vault', 'signer'])('rejects a review from another %s', async (kind) => {
    const f = await deployReleaseFixture();
    const signature = await signReleaseReview(
      kind === 'signer' ? actors.attacker : actors.oracle,
      kind === 'vault' ? actors.attacker.address : f.vault.address,
      reviewFor(f), kind === 'chain' ? 42161 : LOCAL_CHAIN_ID,
    );
    expect((await submit(f, reviewFor(f), signature)).error).toBe('InvalidReviewer');
  });

  it('rejects replaying a review nonce', async () => {
    const f = await deployReleaseFixture();
    expect((await submit(f)).ok).toBe(true);
    expect((await submit(f)).error).toBe('ReviewNonceAlreadyUsed');
  });

  it('rejects an older ALLOW signature arriving after a newer HOLD', async () => {
    const f = await deployReleaseFixture();
    const oldAllow = reviewFor(f);
    const oldSignature = await signReleaseReview(actors.oracle, f.vault.address, oldAllow, LOCAL_CHAIN_ID);
    expect((await submit(f, reviewFor(f, { decision: ReleaseDecision.HOLD, nonce: 2n }))).ok).toBe(true);
    expect((await submit(f, oldAllow, oldSignature)).error).toBe('ReviewNonceAlreadyUsed');
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('ReleaseHeld');
  });

  it('rejects expired and excessively long-lived reviews', async () => {
    const f = await deployReleaseFixture();
    expect((await submit(f, reviewFor(f, { validUntil: f.vm.now - 1n }))).error).toBe('ReviewExpired');
    expect((await submit(f, reviewFor(f, { validUntil: f.vm.now + 601n }))).error).toBe('ReviewTtlTooLong');
    expect((await submit(f, reviewFor(f, { validUntil: f.vm.now + 600n }))).ok).toBe(true);
    f.vm.warp(601);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('ReviewExpired');
  });

  it('invalidates an existing allowance to execute when the oracle key is rotated', async () => {
    const f = await deployReleaseFixture();
    expect((await submit(f)).ok).toBe(true);
    await f.vm.send(actors.owner, 'setOracle', [actors.relayer.address]);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('InvalidReviewer');
    expect((await submit(f, reviewFor(f, { nonce: 2n }))).error).toBe('InvalidReviewer');
  });

  it('keeps unknown data held until a new review allows the release', async () => {
    const f = await deployReleaseFixture();
    expect((await submit(f, reviewFor(f, { decision: ReleaseDecision.HOLD }))).ok).toBe(true);
    f.vm.warp(86_401);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('ReleaseHeld');
    expect((await submit(f, reviewFor(f, { nonce: 2n }))).ok).toBe(true);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).ok).toBe(true);
  });

  it('never reopens a rejected release after route resume or protection expiry', async () => {
    const f = await deployReleaseFixture();
    expect((await submit(f, reviewFor(f, { decision: ReleaseDecision.REJECT }))).ok).toBe(true);
    f.vm.warp(86_401);
    await f.vm.send(actors.owner, 'resume', [ROUTE]);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('ReleaseRejected');
    expect((await submit(f, reviewFor(f, { nonce: 2n }))).error).toBe('ReleaseRejected');
  });

  it('does not consume a release or transfer tokens when the guardian rejects the payout', async () => {
    const f = await deployReleaseFixture();
    expect((await submit(f)).ok).toBe(true);
    await f.vm.send(actors.owner, 'configureRoute', [ROUTE, AMOUNT / 2n, 3600n]);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('RateLimited');
    expect(await f.vm.readContract(f.token, 'balanceOf', [actors.bridge.address])).toBe(0n);
    await f.vm.send(actors.owner, 'configureRoute', [ROUTE, AMOUNT, 3600n]);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).ok).toBe(true);
  });

  it('cannot execute before the required risk tier lands or after it is resumed', async () => {
    const f = await deployReleaseFixture();
    expect((await submit(f, reviewFor(f, { minimumTier: ResponseTier.THROTTLE }))).ok).toBe(true);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('RequiredProtectionMissing');
    const att = { routeId: ROUTE, riskScore: 65n, validUntil: f.vm.now + 300n, nonce: 1n };
    const signature = await signAttestation(actors.oracle, f.vm.address, att, LOCAL_CHAIN_ID);
    expect((await f.vm.send(actors.relayer, 'submitAttestation', [att.routeId, att.riskScore, att.validUntil, att.nonce, signature])).ok).toBe(true);
    await f.vm.send(actors.owner, 'resume', [ROUTE]);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('RequiredProtectionMissing');
    expect((await submit(f, reviewFor(f, { nonce: 2n }))).ok).toBe(true);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).ok).toBe(true);
  });
});
