import { describe, expect, it } from 'vitest';
import { keccak256, toHex } from 'viem';
import guardian from '../../../src/tripwire/guardian.artifact.js';
import demo from '../../../scripts/tripwire/testnet/contracts.artifact.js';
import { actors, GuardianVM, LOCAL_CHAIN_ID } from '../../../src/tripwire/guardianVM.js';
import { ResponseTier, signAttestation } from '../../../src/tripwire/onChain.js';
import { ReleaseDecision, signReleaseReview } from '../../../scripts/tripwire/review.js';

const ROUTE = keccak256(toHex('route-a')), OTHER = keccak256(toHex('route-b'));
const MESSAGE = keccak256(toHex('late-large-request'));
const CAP = 1_000_000n, WINDOW = 3600n, START = 1_800_000_000n;

async function setup() {
  const vm = await GuardianVM.deploy(guardian, { start: START });
  for (const id of [ROUTE, OTHER]) expect((await vm.send(actors.owner, 'configureRoute', [id, CAP, WINDOW])).ok).toBe(true);
  await vm.send(actors.owner, 'setProtected', [actors.bridge.address, ROUTE, true]);
  return vm;
}

describe('route isolation and rolling outflow', () => {
  it('a reporter authorized for one route cannot spend another route budget', async () => {
    const vm = await setup();
    expect((await vm.send(actors.bridge, 'onTokenOutflow', [OTHER, 1n])).error).toBe('NotProtected');
    expect((await vm.read<{ outflowInWindow: bigint }>('getRoute', [OTHER])).outflowInWindow).toBe(0n);
  });
  it('blocks two cap-sized bursts one second apart across the old window boundary', async () => {
    const vm = await setup(); vm.warp(WINDOW - 1n);
    expect((await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, CAP])).ok).toBe(true); vm.warp(1n);
    expect((await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, CAP])).error).toBe('RateLimited');
    expect(await vm.read('routeStatus', [ROUTE])).toBe(1);
  });
  it('reconfiguring a cap preserves already spent budget', async () => {
    const vm = await setup(); await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, CAP]);
    await vm.send(actors.owner, 'configureRoute', [ROUTE, CAP, WINDOW]);
    expect((await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, 1n])).error).toBe('RateLimited');
  });
  it('permission revocation is local and reporters for the same route share its budget', async () => {
    const vm = await setup();
    await vm.send(actors.owner, 'setProtected', [actors.relayer.address, ROUTE, true]);
    await vm.send(actors.owner, 'setProtected', [actors.bridge.address, OTHER, true]);
    await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, CAP - 1n]);
    expect((await vm.send(actors.relayer, 'onTokenOutflow', [ROUTE, 2n])).error).toBe('RateLimited');
    await vm.send(actors.owner, 'setProtected', [actors.bridge.address, ROUTE, false]);
    expect((await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, 1n])).error).toBe('NotProtected');
    expect((await vm.send(actors.relayer, 'onTokenOutflow', [ROUTE, 1n])).ok).toBe(true);
    expect((await vm.send(actors.bridge, 'onTokenOutflow', [OTHER, CAP])).ok).toBe(true);
  });
  it('never resets spend on resume, cap reduction or tier escalation', async () => {
    const vm = await setup(); await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, CAP * 3n / 4n]);
    const att = { routeId: ROUTE, riskScore: 65n, validUntil: vm.now + 300n, nonce: 1n };
    await vm.send(actors.relayer, 'submitAttestation', [ROUTE, 65n, att.validUntil, 1n,
      await signAttestation(actors.oracle, vm.address, att, LOCAL_CHAIN_ID)]);
    expect((await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, 1n])).error).toBe('RateLimited');
    await vm.send(actors.owner, 'resume', [ROUTE]);
    await vm.send(actors.owner, 'configureRoute', [ROUTE, CAP / 2n, WINDOW]);
    expect(await vm.read('rollingUsage', [ROUTE])).toBe(CAP * 3n / 4n);
    expect((await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, 1n])).error).toBe('RateLimited');
    expect((await vm.send(actors.owner, 'configureRoute', [ROUTE, CAP, WINDOW + 1n])).error).toBe('WindowChangeNotAllowed');
  });
  it('expires a bucket only a full window after its last spend, and views age out without a write', async () => {
    const vm = await setup();
    await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, CAP / 2n]); vm.warp(224n);
    await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, CAP / 2n]); vm.warp(WINDOW - 224n);
    expect(await vm.read('rollingUsage', [ROUTE])).toBe(CAP);
    expect((await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, 1n])).error).toBe('RateLimited');
    vm.warp(223n); expect(await vm.read('routeStatus', [ROUTE])).toBe(1);
    vm.warp(1n); expect(await vm.read('rollingUsage', [ROUTE])).toBe(0n);
    expect((await vm.read<{ outflowInWindow: bigint }>('getRoute', [ROUTE])).outflowInWindow).toBe(0n);
    expect((await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, CAP])).ok).toBe(true);
  });
  it.each([1n, 17n, 3600n])('never accepts more than the rolling cap for window %s over many ring rotations', async (window) => {
    const vm = await GuardianVM.deploy(guardian, { start: START });
    await vm.send(actors.owner, 'configureRoute', [ROUTE, CAP, window]);
    await vm.send(actors.owner, 'setProtected', [actors.bridge.address, ROUTE, true]);
    const ledger: { time: bigint; amount: bigint }[] = [];
    for (let i = 0; i < 80; i++) {
      vm.warp(BigInt((i * 43 + 7) % 19) * window / 16n);
      const amount = BigInt((i * 31 + 3) % 7 + 1) * CAP / 8n;
      const before = await vm.read<bigint>('rollingUsage', [ROUTE]);
      const result = await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, amount]);
      if (result.ok) ledger.push({ time: vm.now, amount });
      else { expect(result.error).toBe('RateLimited'); expect(await vm.read('rollingUsage', [ROUTE])).toBe(before); }
      const exact = ledger.filter((entry) => entry.time > vm.now - window).reduce((sum, entry) => sum + entry.amount, 0n);
      expect(exact).toBeLessThanOrEqual(CAP); expect(await vm.read<bigint>('rollingUsage', [ROUTE])).toBeGreaterThanOrEqual(exact);
    }
    vm.warp(window * 2n); expect(await vm.read('rollingUsage', [ROUTE])).toBe(0n);
    expect((await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, CAP])).ok).toBe(true);
  });
  it('rejects zero outflows and treats a one-unit throttled cap as exhausted', async () => {
    const vm = await setup();
    expect((await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, 0n])).error).toBe('InvalidOutflow');
    await vm.send(actors.owner, 'configureRoute', [ROUTE, 1n, WINDOW]);
    const att = { routeId: ROUTE, riskScore: 65n, validUntil: vm.now + 300n, nonce: 1n };
    await vm.send(actors.relayer, 'submitAttestation', [ROUTE, 65n, att.validUntil, 1n,
      await signAttestation(actors.oracle, vm.address, att, LOCAL_CHAIN_ID)]);
    expect(await vm.read('routeStatus', [ROUTE])).toBe(1);
    expect((await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, 1n])).error).toBe('RateLimited');
  });
  it('handles maximum uint128 caps without truncating usage and bounds populated-ring gas', async () => {
    const vm = await setup(); const max = (1n << 128n) - 1n;
    await vm.send(actors.owner, 'configureRoute', [ROUTE, max, WINDOW]);
    expect((await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, max])).ok).toBe(true);
    expect((await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, 1n])).error).toBe('RateLimited');
    vm.warp(WINDOW * 2n);
    for (let i = 0; i < 17; i++) { await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, 1n]); vm.warp(225n); }
    const result = await vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, 1n]);
    expect(result.ok).toBe(true); expect(result.gas).toBeLessThan(120_000n);
  });
});

async function delayedFixture() {
  const vm = await setup();
  const token = await vm.deployContract(demo.DemoUSDC, [actors.owner.address]);
  const vault = await vm.deployContract(demo.ProtectedVault, [actors.owner.address, token.address, vm.address, ROUTE]);
  await vm.send(actors.owner, 'setProtected', [vault.address, ROUTE, true]);
  await vm.sendContract(token, actors.owner, 'mint', [vault.address, CAP * 3n]);
  const att = { routeId: ROUTE, riskScore: 85n, validUntil: vm.now + 300n, nonce: 1n };
  const signature = await signAttestation(actors.oracle, vm.address, att, LOCAL_CHAIN_ID);
  await vm.send(actors.relayer, 'submitAttestation', [ROUTE, att.riskScore, att.validUntil, att.nonce, signature]);
  vm.warp(1801n);
  await vm.sendContract(vault, actors.owner, 'requestRelease', [MESSAGE, actors.attacker.address, CAP / 5n]);
  const review = async (nonce = 1n, decision = ReleaseDecision.ALLOW, minimumTier = ResponseTier.DELAY) => {
    const r = { messageId: MESSAGE, routeId: ROUTE, token: token.address, recipient: actors.attacker.address,
      amount: CAP / 5n, minimumTier, decision, validUntil: vm.now + 300n, nonce };
    return vm.sendContract(vault, actors.relayer, 'reviewRelease', [MESSAGE, decision, r.minimumTier,
      r.validUntil, nonce, await signReleaseReview(actors.oracle, vault.address, r, LOCAL_CHAIN_ID)]);
  };
  return { vm, token, vault, review };
}

describe('per-request DELAY policy', () => {
  it('holds a new large request even after the route-wide review window has passed', async () => {
    const f = await delayedFixture(); expect((await f.review()).ok).toBe(true);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('ReleaseDelayed');
    expect(await f.vm.readContract(f.token, 'balanceOf', [actors.attacker.address])).toBe(0n);
  });
  it('does not reopen a request clock on repeated ALLOW/HOLD reviews, and requires a fresh review at maturity', async () => {
    const f = await delayedFixture(); await f.review();
    const until = await f.vm.readContract<bigint>(f.vault, 'releaseDelayUntil', [MESSAGE]);
    f.vm.warp(900n); await f.review(2n, ReleaseDecision.HOLD); await f.review(3n);
    expect(await f.vm.readContract(f.vault, 'releaseDelayUntil', [MESSAGE])).toBe(until);
    f.vm.warp(899n); await f.review(4n);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('ReleaseDelayed');
    f.vm.warp(1n); expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).ok).toBe(true);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('AlreadyExecuted');
  });
  it('an ALLOW that expired during the delay cannot pay without a fresh review', async () => {
    const f = await delayedFixture(); await f.review(); f.vm.warp(1800n);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('ReviewExpired');
    await f.review(2n); expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).ok).toBe(true);
  });
  it('cannot bypass a sticky request delay using owner resume or a lower minimum tier', async () => {
    const f = await delayedFixture(); await f.review();
    await f.vm.send(actors.owner, 'resume', [ROUTE]); await f.review(2n, ReleaseDecision.ALLOW, ResponseTier.NONE);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('ReleaseDelayed');
    f.vm.warp(1800n); await f.review(3n, ReleaseDecision.ALLOW, ResponseTier.NONE);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).ok).toBe(true);
  });
  it('does not inherit another request clock and small requests remain immediately payable', async () => {
    const f = await delayedFixture(); await f.review(); f.vm.warp(1800n);
    const next = keccak256(toHex('next-request')), small = keccak256(toHex('small-request'));
    for (const [id, amount] of [[next, CAP / 5n], [small, CAP / 10n]] as const) {
      await f.vm.sendContract(f.vault, actors.owner, 'requestRelease', [id, actors.attacker.address, amount]);
      const review = { messageId: id, routeId: ROUTE, token: f.token.address, recipient: actors.attacker.address,
        amount, minimumTier: ResponseTier.NONE, decision: ReleaseDecision.ALLOW, validUntil: f.vm.now + 300n, nonce: 1n };
      await f.vm.sendContract(f.vault, actors.relayer, 'reviewRelease', [id, review.decision, review.minimumTier,
        review.validUntil, 1n, await signReleaseReview(actors.oracle, f.vault.address, review, LOCAL_CHAIN_ID)]);
    }
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [next])).error).toBe('ReleaseDelayed');
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [small])).ok).toBe(true);
  });
  it('requires starting a request clock when a previously clear review encounters DELAY', async () => {
    const f = await delayedFixture(); await f.vm.send(actors.owner, 'resume', [ROUTE]);
    await f.review(1n, ReleaseDecision.ALLOW, ResponseTier.NONE);
    const att = { routeId: ROUTE, riskScore: 85n, validUntil: f.vm.now + 300n, nonce: 2n };
    await f.vm.send(actors.relayer, 'submitAttestation', [ROUTE, 85n, att.validUntil, 2n,
      await signAttestation(actors.oracle, f.vm.address, att, LOCAL_CHAIN_ID)]);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('RequestDelayNotStarted');
    await f.review(2n); expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('ReleaseDelayed');
  });
  it('keeps rejection terminal even after the request delay and route protection expire', async () => {
    const f = await delayedFixture(); await f.review(); await f.review(2n, ReleaseDecision.REJECT); f.vm.warp(86401n);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE])).error).toBe('ReleaseRejected');
  });
});
