// Regression tests for the Tripwire security audit of 0134301 (docs/plans/tripwire-audit-remediation.md).
// Each block was first written as a proof of concept that PASSED while the
// finding reproduced; here its assertions are inverted to pin the fix.
import { readFileSync } from 'node:fs';
import solc from 'solc';
import { describe, expect, it } from 'vitest';
import { concatHex, keccak256, toHex } from 'viem';
import { standardJsonInput } from '../compile.mjs';
import guardian from '../../../src/tripwire/guardian.artifact.js';
import demo from '../../../scripts/tripwire/testnet/contracts.artifact.js';
import escrowArtifact from '../../../scripts/tripwire/testnet/cctpEscrow.artifact.js';
import { actors, GuardianVM, LOCAL_CHAIN_ID, type GuardianArtifact } from '../../../src/tripwire/guardianVM.js';
import { cctpAddressWord, cctpBeneficiaryHook, cctpEscrowReleaseId } from '../../../src/chains/evm/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { nonce } from '../../../scripts/tripwire/__tests__/fixtures/cctp.js';
import { ReleaseDecision, signReleaseReview } from '../../../scripts/tripwire/review.js';
import { ResponseTier, signAttestation } from '../../../src/tripwire/onChain.js';

const input = standardJsonInput('TripwireDemo.sol');
input.sources['CctpHarness.sol'] = { content: readFileSync(new URL('./fixtures/CctpHarness.sol', import.meta.url), 'utf8')
  .replace('../../src/TripwireDemo.sol', 'TripwireDemo.sol') };
const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
const harness: GuardianArtifact = { abi: compiled.contracts['CctpHarness.sol'].CctpHarness.abi,
  bytecode: `0x${compiled.contracts['CctpHarness.sol'].CctpHarness.evm.bytecode.object}` };
const u32 = (v: number) => toHex(v, { size: 4 });
const u256 = (v: bigint) => toHex(v, { size: 32 });
const ROUTE = keccak256(toHex('audit-route'));
const HOUR = 3600n, DAY = 24n * HOUR;
const ZERO = '0x0000000000000000000000000000000000000000';

let attestationNonce = 1_000n;
async function attest(vm: GuardianVM, riskScore: bigint) {
  const a = { routeId: ROUTE, riskScore, validUntil: vm.now + 300n, nonce: ++attestationNonce };
  return vm.send(actors.relayer, 'submitAttestation', [ROUTE, riskScore, a.validUntil, a.nonce,
    await signAttestation(actors.oracle, vm.address, a, LOCAL_CHAIN_ID)]);
}

async function protectedVault(cap = 1_000n) {
  const vm = await GuardianVM.deploy(guardian);
  const token = await vm.deployContract(demo.DemoUSDC, [actors.owner.address]);
  const vault = await vm.deployContract(demo.ProtectedVault, [actors.owner.address, token.address, vm.address, ROUTE]);
  await vm.send(actors.owner, 'configureRoute', [ROUTE, cap, 3600n]);
  await vm.send(actors.owner, 'setProtected', [vault.address, ROUTE, true]);
  return { vm, token, vault };
}

describe('CRIT-1: the guardian owner cannot become the oracle or loosen a protected route in one move', () => {
  it('has no instant oracle swap left in its ABI', () => {
    const names = (guardian.abi as { name?: string }[]).map((f) => f.name);
    expect(names).not.toContain('setOracle');
    expect(names).toEqual(expect.arrayContaining(['proposeOracle', 'acceptOracle', 'cancelOracleRotation', 'disableOracle']));
  });

  it('blocks the audited drain: a frozen route stays frozen, the cap stays put, and the owner cannot approve a payout', async () => {
    const { vm, token, vault } = await protectedVault();
    const POOL = 5_000_000n * 10n ** 6n;
    await vm.sendContract(token, actors.owner, 'mint', [vault.address, POOL]);
    expect((await attest(vm, 100n)).ok).toBe(true);
    expect(await vm.read('isPaused', [ROUTE])).toBe(true);
    // The oracle swap is only a proposal: two days of public notice, then anyone may execute it.
    expect((await vm.send(actors.owner, 'proposeOracle', [actors.owner.address])).ok).toBe(true);
    expect(await vm.read('pendingOracle')).toBe(actors.owner.address);
    expect(await vm.read('pendingOracleAt')).toBe(vm.now + 2n * DAY);
    const early = await vm.send(actors.owner, 'acceptOracle');
    expect(early.error).toBe('RotationNotReady');
    // Raising the cap of a protected route is refused; lowering it is not.
    expect((await vm.send(actors.owner, 'configureRoute', [ROUTE, POOL, 3600n])).error).toBe('RaiseDuringProtection');
    expect((await vm.send(actors.owner, 'configureRoute', [ROUTE, 500n, 3600n])).ok).toBe(true);
    // A payout reviewed by the owner's key is still not a payout the oracle allowed.
    const id = keccak256(toHex('owner-drain'));
    expect((await vm.sendContract(vault, actors.owner, 'requestRelease', [id, actors.attacker.address, POOL])).ok).toBe(true);
    const r = { messageId: id, routeId: ROUTE, token: token.address, recipient: actors.attacker.address, amount: POOL,
      decision: ReleaseDecision.ALLOW, minimumTier: ResponseTier.NONE, validUntil: vm.now + 300n, nonce: 1n };
    expect((await vm.sendContract(vault, actors.owner, 'reviewRelease', [id, r.decision, r.minimumTier, r.validUntil, 1n,
      await signReleaseReview(actors.owner, vault.address, r, LOCAL_CHAIN_ID)])).error).toBe('InvalidReviewer');
    expect((await vm.sendContract(vault, actors.owner, 'executeRelease', [id])).error).toBe('ReleaseNotReviewed');
    expect(await vm.readContract(token, 'balanceOf', [actors.attacker.address])).toBe(0n);
    expect(await vm.readContract(token, 'balanceOf', [vault.address])).toBe(POOL);
  });

  it('installs a proposed oracle only after the notice, and lets the owner cancel it first', async () => {
    const { vm } = await protectedVault();
    expect((await vm.send(actors.owner, 'proposeOracle', [actors.bridge.address])).ok).toBe(true);
    expect((await vm.send(actors.owner, 'cancelOracleRotation')).ok).toBe(true);
    vm.warp(2n * DAY);
    expect((await vm.send(actors.attacker, 'acceptOracle')).error).toBe('NoPendingOracle');
    expect((await vm.send(actors.owner, 'proposeOracle', [actors.bridge.address])).ok).toBe(true);
    vm.warp(2n * DAY - 1n);
    expect((await vm.send(actors.attacker, 'acceptOracle')).error).toBe('RotationNotReady');
    vm.warp(1n);
    expect((await vm.send(actors.attacker, 'acceptOracle')).ok).toBe(true);
    expect(await vm.read('oracle')).toBe(actors.bridge.address);
    expect(await vm.read('pendingOracle')).toBe(ZERO);
  });

  it('kills the oracle instantly: no attestation, review or payout verifies while it is disabled', async () => {
    const { vm, token, vault } = await protectedVault(10n ** 12n);
    await vm.sendContract(token, actors.owner, 'mint', [vault.address, 1_000n]);
    const id = keccak256(toHex('pending'));
    await vm.sendContract(vault, actors.owner, 'requestRelease', [id, actors.bridge.address, 1_000n]);
    const r = { messageId: id, routeId: ROUTE, token: token.address, recipient: actors.bridge.address, amount: 1_000n,
      decision: ReleaseDecision.ALLOW, minimumTier: ResponseTier.NONE, validUntil: vm.now + 300n, nonce: 1n };
    const allow = await signReleaseReview(actors.oracle, vault.address, r, LOCAL_CHAIN_ID);
    expect((await vm.sendContract(vault, actors.relayer, 'reviewRelease', [id, r.decision, r.minimumTier, r.validUntil, 1n, allow])).ok).toBe(true);
    expect((await vm.send(actors.owner, 'disableOracle')).ok).toBe(true);
    expect((await vm.sendContract(vault, actors.attacker, 'executeRelease', [id])).error).toBe('InvalidReviewer');
    expect((await attest(vm, 95n)).error).toBe('InvalidSigner');
    expect(await vm.readContract(token, 'balanceOf', [actors.bridge.address])).toBe(0n);
  });

  it('lets the cap rise again only after an explicit resume', async () => {
    const { vm } = await protectedVault();
    expect((await attest(vm, 65n)).ok).toBe(true);
    expect((await vm.send(actors.owner, 'configureRoute', [ROUTE, 2_000n, 3600n])).error).toBe('RaiseDuringProtection');
    expect((await vm.send(actors.owner, 'resume', [ROUTE])).ok).toBe(true);
    expect((await vm.send(actors.owner, 'configureRoute', [ROUTE, 2_000n, 3600n])).ok).toBe(true);
  });
});

describe('CRIT-2: a REJECT is a 7-day hard hold, never a permanent loss of a backed CCTP credit', () => {
  async function escrowWithCredit() {
    const vm = await GuardianVM.deploy(guardian);
    const token = await vm.deployContract(demo.DemoUSDC, [actors.owner.address]);
    const transmitter = await vm.deployContract(harness, [actors.relayer.address, token.address]);
    const vault = await vm.deployContract(escrowArtifact, [token.address, vm.address, ROUTE,
      { transmitter: transmitter.address, destinationMessenger: actors.bridge.address, sourceDomain: 6,
        sourceMessenger: route.source.messenger, sourceToken: route.source.usdc }]);
    await vm.sendContract(token, actors.owner, 'transferOwnership', [transmitter.address]);
    await vm.send(actors.owner, 'configureRoute', [ROUTE, 10n ** 12n, 3600n]);
    await vm.send(actors.owner, 'setProtected', [vault.address, ROUTE, true]);
    const NET = 1_000_000n;
    const body = concatHex([u32(1), cctpAddressWord(route.source.usdc), cctpAddressWord(vault.address), u256(NET),
      cctpAddressWord(actors.owner.address), u256(1n), u256(0n), u256(0n), cctpBeneficiaryHook(actors.bridge.address)]);
    const message = concatHex([u32(1), u32(6), u32(0), nonce, cctpAddressWord(route.source.messenger),
      cctpAddressWord(actors.bridge.address), cctpAddressWord(vault.address), u32(2000), u32(2000), body]);
    expect((await vm.sendContract(vault, actors.attacker, 'receiveCctp', [message, await actors.relayer.sign({ hash: keccak256(message) })])).ok).toBe(true);
    const id = cctpEscrowReleaseId(LOCAL_CHAIN_ID, vault.address, 6, nonce);
    const review = async (decision: ReleaseDecision, n: bigint, recipient = actors.bridge.address) => {
      const r = { messageId: id, routeId: ROUTE, token: token.address, recipient, amount: NET,
        decision, minimumTier: ResponseTier.NONE, validUntil: vm.now + 300n, nonce: n };
      return vm.sendContract(vault, actors.relayer, 'reviewRelease', [id, decision, r.minimumTier, r.validUntil, n,
        await signReleaseReview(actors.oracle, vault.address, r, LOCAL_CHAIN_ID)]);
    };
    return { vm, token, vault, id, NET, review };
  }

  it('holds a rejected credit for 7 days, then a fresh ALLOW pays its authenticated beneficiary', async () => {
    const f = await escrowWithCredit();
    expect((await f.review(ReleaseDecision.REJECT, 1n)).ok).toBe(true);
    const rejectedAt = await f.vm.readContract<bigint>(f.vault, 'rejectedAt', [f.id]);
    expect(rejectedAt).toBe(f.vm.now);
    expect((await f.review(ReleaseDecision.ALLOW, 2n)).error).toBe('ReleaseRejected');
    f.vm.warp(7n * DAY - 1n);
    expect((await f.review(ReleaseDecision.ALLOW, 2n)).error).toBe('ReleaseRejected');
    expect((await f.vm.sendContract(f.vault, actors.bridge, 'executeRelease', [f.id])).error).toBe('ReleaseRejected');
    f.vm.warp(1n);
    // A re-review cannot redirect the credit: its recipient is the authenticated beneficiary.
    expect((await f.review(ReleaseDecision.ALLOW, 2n, actors.attacker.address)).error).toBe('InvalidReviewer');
    expect((await f.review(ReleaseDecision.ALLOW, 2n)).ok).toBe(true);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'executeRelease', [f.id])).ok).toBe(true);
    expect(await f.vm.readContract(f.token, 'balanceOf', [actors.bridge.address])).toBe(f.NET);
    expect(await f.vm.readContract(f.token, 'balanceOf', [f.vault.address])).toBe(0n);
  });

  it('restarts the hold when the release is rejected again, and never pays a rejected release', async () => {
    const f = await escrowWithCredit();
    expect((await f.review(ReleaseDecision.REJECT, 1n)).ok).toBe(true);
    f.vm.warp(7n * DAY);
    expect((await f.review(ReleaseDecision.REJECT, 2n)).ok).toBe(true);
    expect(await f.vm.readContract(f.vault, 'rejectedAt', [f.id])).toBe(f.vm.now);
    f.vm.warp(7n * DAY - 1n);
    expect((await f.review(ReleaseDecision.ALLOW, 3n)).error).toBe('ReleaseRejected');
    expect((await f.vm.sendContract(f.vault, actors.bridge, 'executeRelease', [f.id])).error).toBe('ReleaseRejected');
    expect(await f.vm.readContract(f.token, 'balanceOf', [f.vault.address])).toBe(f.NET);
  });
});

describe('HIGH-3: the oracle alone cannot hold a route for more than 72 hours at a time', () => {
  it('stops a FREEZE refreshed every 23 hours at 72 hours, and refuses refreshes through the cooldown', async () => {
    const { vm } = await protectedVault();
    const start = vm.now;
    expect(await vm.read('protectionLimit', [ROUTE])).toBe(start + 72n * HOUR);
    for (let day = 0; day < 4; day++) {
      expect((await attest(vm, 95n)).ok).toBe(true);
      vm.warp(23n * HOUR);
    }
    // 4 × 23 h = 92 h after the first FREEZE: the 72-hour span ended 20 hours ago.
    expect(await vm.read('isPaused', [ROUTE])).toBe(false);
    expect(await vm.read('currentTier', [ROUTE])).toBe(ResponseTier.NONE);
    expect(await vm.read('protectionLimit', [ROUTE])).toBe(start + 72n * HOUR);
    const refused = await attest(vm, 100n);
    expect(refused.error).toBe('ProtectionSpanExhausted');
    // After the 24-hour clear gap a new span may start.
    vm.warp(start + 96n * HOUR - vm.now);
    expect((await attest(vm, 95n)).ok).toBe(true);
    expect(await vm.read('isPaused', [ROUTE])).toBe(true);
    expect(await vm.read<{ protectionSince: bigint }>('getRoute', [ROUTE])).toMatchObject({ protectionSince: vm.now });
  });

  it('caps a refresh near the end of the span to the span itself', async () => {
    const { vm } = await protectedVault();
    const start = vm.now;
    expect((await attest(vm, 95n)).ok).toBe(true);
    vm.warp(70n * HOUR);
    expect((await attest(vm, 95n)).ok).toBe(true);
    expect(await vm.read<{ pausedUntil: bigint; tierExpiresAt: bigint }>('getRoute', [ROUTE]))
      .toMatchObject({ pausedUntil: start + 72n * HOUR, tierExpiresAt: start + 72n * HOUR });
  });

  it('lets only the owner extend protection through a real incident', async () => {
    const { vm } = await protectedVault();
    expect((await attest(vm, 95n)).ok).toBe(true);
    vm.warp(73n * HOUR);
    expect((await attest(vm, 95n)).error).toBe('ProtectionSpanExhausted');
    expect((await vm.send(actors.attacker, 'rearmProtection', [ROUTE])).error).toBe('OwnableUnauthorizedAccount');
    expect((await vm.send(actors.owner, 'rearmProtection', [ROUTE])).ok).toBe(true);
    expect((await attest(vm, 95n)).ok).toBe(true);
    expect(await vm.read('isPaused', [ROUTE])).toBe(true);
  });

  it('gives the next incident a full span once the owner has resumed the route', async () => {
    const { vm } = await protectedVault();
    expect((await attest(vm, 95n)).ok).toBe(true);
    vm.warp(71n * HOUR);
    expect((await vm.send(actors.owner, 'resume', [ROUTE])).ok).toBe(true);
    expect((await attest(vm, 95n)).ok).toBe(true);
    expect(await vm.read<{ pausedUntil: bigint }>('getRoute', [ROUTE])).toMatchObject({ pausedUntil: vm.now + DAY });
  });
});

describe('MED-1: DELAY holds a split payout like the payout itself', () => {
  async function delayed() {
    const vm = await GuardianVM.deploy(guardian);
    const CAP = 1_000_000n;
    await vm.send(actors.owner, 'configureRoute', [ROUTE, CAP, 3600n]);
    await vm.send(actors.owner, 'setProtected', [actors.bridge.address, ROUTE, true]);
    expect((await attest(vm, 85n)).ok).toBe(true);
    expect(await vm.read('currentTier', [ROUTE])).toBe(ResponseTier.DELAY);
    return { vm, CAP, out: (amount: bigint) => vm.send(actors.bridge, 'onTokenOutflow', [ROUTE, amount]) };
  }

  it('lets 10% of the cap through in total during the review window, in any number of pieces', async () => {
    const { vm, CAP, out } = await delayed();
    expect((await out(CAP * 4n / 10n)).error).toBe('OutflowDelayed');
    expect((await out(CAP / 20n)).ok).toBe(true);
    expect((await out(CAP / 20n)).ok).toBe(true);
    expect((await out(1n)).error).toBe('OutflowDelayed');
    expect(await vm.read('outflowDelay', [ROUTE, 1n])).toBe(1800n);
    expect(await vm.read<{ delayedOutflow: bigint }>('getRoute', [ROUTE])).toMatchObject({ delayedOutflow: CAP / 10n });
    vm.warp(1800n);
    expect(await vm.read('outflowDelay', [ROUTE, 1n])).toBe(0n);
    expect((await out(CAP / 10n)).ok).toBe(true);
  });

  it('opens a fresh budget each time the route enters DELAY again', async () => {
    const { vm, CAP, out } = await delayed();
    expect((await out(CAP / 10n)).ok).toBe(true);
    expect((await out(1n)).error).toBe('OutflowDelayed');
    vm.warp(DAY);
    expect(await vm.read('currentTier', [ROUTE])).toBe(ResponseTier.NONE);
    expect((await attest(vm, 85n)).ok).toBe(true);
    expect(await vm.read<{ delayedOutflow: bigint }>('getRoute', [ROUTE])).toMatchObject({ delayedOutflow: 0n });
    expect((await out(CAP / 10n)).ok).toBe(true);
  });

  it('gives a small vault request the per-request hold once the window budget is spent', async () => {
    const { vm, token, vault } = await protectedVault(1_000_000n);
    await vm.sendContract(token, actors.owner, 'mint', [vault.address, 1_000_000n]);
    expect((await attest(vm, 85n)).ok).toBe(true);
    const pay = async (tag: string, n: bigint) => {
      const id = keccak256(toHex(tag));
      await vm.sendContract(vault, actors.owner, 'requestRelease', [id, actors.bridge.address, 100_000n]);
      const r = { messageId: id, routeId: ROUTE, token: token.address, recipient: actors.bridge.address, amount: 100_000n,
        decision: ReleaseDecision.ALLOW, minimumTier: ResponseTier.NONE, validUntil: vm.now + 300n, nonce: n };
      expect((await vm.sendContract(vault, actors.relayer, 'reviewRelease', [id, r.decision, r.minimumTier, r.validUntil, n,
        await signReleaseReview(actors.oracle, vault.address, r, LOCAL_CHAIN_ID)])).ok).toBe(true);
      return { id, execute: () => vm.sendContract(vault, actors.attacker, 'executeRelease', [id]) };
    };
    const first = await pay('first-10pct', 1n);
    expect((await first.execute()).ok).toBe(true);
    const second = await pay('second-10pct', 1n);
    expect(await vm.readContract(vault, 'releaseDelayUntil', [second.id])).toBe(vm.now + 1800n);
    expect((await second.execute()).error).toBe('ReleaseDelayed');
  });
});
