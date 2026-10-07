// The guardian executed in a real EVM. Each describe block corresponds to one
// invariant in the contract's header comment, and each test tries to break it.

import { beforeEach, describe, expect, it } from 'vitest';
import { hashTypedData, hexToSignature, keccak256, signatureToHex, toHex, type Hex } from 'viem';
import { compileGuardian } from '../compile.mjs';
import { attestationDomain, ATTESTATION_TYPES, ResponseTier as Tier } from '../../../src/tripwire/onChain.js';
import type { GuardianVM } from '../../../src/tripwire/guardianVM.js';
import {
  CHAIN_ID,
  artifact,
  attacker,
  bridge,
  deployGuardian,
  oracle,
  owner,
  relayer,
  signAttestation,
  type Attestation,
} from './evm.js';

const ROUTE = keccak256(toHex('eth:arb:USDC'));
const OTHER_ROUTE = keccak256(toHex('base:op:WETH'));
const CAP = 1_000_000n;
const WINDOW = 3600n;
const HOUR = 3600n;
const DAY = 24n * HOUR;
const DELAY_WINDOW = 30n * 60n;

enum Status { ACTIVE, RATE_LIMITED, PAUSED }

let g: GuardianVM;
let nonce = 0n;

beforeEach(async () => {
  g = await deployGuardian();
  expect((await g.send(owner, 'configureRoute', [ROUTE, CAP, WINDOW])).ok).toBe(true);
  expect((await g.send(owner, 'setProtected', [bridge.address, ROUTE, true])).ok).toBe(true);
});

const att = (over: Partial<Attestation> = {}): Attestation => ({
  routeId: ROUTE,
  riskScore: 95n,
  validUntil: g.now + 300n,
  nonce: ++nonce,
  ...over,
});

async function submit(a: Attestation, sig?: Hex) {
  const signature = sig ?? (await signAttestation(oracle, g.address, a));
  return g.send(relayer, 'submitAttestation', [a.routeId, a.riskScore, a.validUntil, a.nonce, signature]);
}

const pausedUntil = async () => (await g.read<{ pausedUntil: bigint }>('getRoute', [ROUTE])).pausedUntil;

// --------------------------------------------------------------------------

// The dashboard ships the committed artifact. If it drifts from the source,
// the demo runs a contract nobody tested.
describe('artifact', () => {
  it('the committed artifact is exactly what the source compiles to', () => {
    const fresh = compileGuardian();
    expect(fresh.errors).toEqual([]);
    expect(fresh.ours).toEqual([]);
    expect(artifact.bytecode, 'stale artifact: run `node contracts/evm/compile.mjs`').toBe(fresh.artifact.bytecode);
  });
});

describe('deployment', () => {
  it('rejects a zero oracle, so the guardian cannot be deployed un-pausable', async () => {
    await expect(deployGuardian('0x0000000000000000000000000000000000000000')).rejects.toMatchObject({
      reason: 'ZeroAddress',
    });
  });

  it('records the owner and oracle it was given', async () => {
    expect(await g.read('owner')).toBe(owner.address);
    expect(await g.read('oracle')).toBe(oracle.address);
  });
});

// The off-chain signer and the contract must agree on one encoding, or every
// attestation in production silently fails signature recovery.
describe('EIP-712 encoding', () => {
  it('viem signs the same digest the contract verifies', async () => {
    const a = att();
    const onChain = await g.read<Hex>('hashAttestation', [a.routeId, a.riskScore, a.validUntil, a.nonce]);
    const offChain = hashTypedData({
      domain: attestationDomain(CHAIN_ID, g.address),
      types: ATTESTATION_TYPES,
      primaryType: 'Attestation',
      message: a,
    });
    expect(onChain).toBe(offChain);
  });
});

describe('EIP-7265 outflow cap', () => {
  it('lets outflows through up to the cap, then rejects the one that crosses it', async () => {
    expect((await g.send(bridge, 'onTokenOutflow', [ROUTE, 600_000n])).ok).toBe(true);
    expect((await g.send(bridge, 'onTokenOutflow', [ROUTE, 400_000n])).ok).toBe(true);
    const over = await g.send(bridge, 'onTokenOutflow', [ROUTE, 1n]);
    expect(over.error).toBe('RateLimited');
    expect(over.errorArgs).toEqual([ROUTE, CAP + 1n, CAP]);
  });

  it('resets usage when the window rolls', async () => {
    await g.send(bridge, 'onTokenOutflow', [ROUTE, CAP]);
    expect(await g.read('routeStatus', [ROUTE])).toBe(Status.RATE_LIMITED);
    g.warp(WINDOW);
    expect(await g.read('routeStatus', [ROUTE])).toBe(Status.ACTIVE);
    expect((await g.send(bridge, 'onTokenOutflow', [ROUTE, CAP])).ok).toBe(true);
  });

  it('refuses outflow reports from contracts it does not protect', async () => {
    expect((await g.send(attacker, 'onTokenOutflow', [ROUTE, 1n])).error).toBe('NotProtected');
  });

  // Failing closed on a route the guardian knows nothing about.
  it('rejects outflows on an unconfigured route', async () => {
    expect((await g.send(bridge, 'onTokenOutflow', [OTHER_ROUTE, 1n])).error).toBe('RouteNotConfigured');
  });

  it('rejects a zero cap or a zero window at configuration', async () => {
    expect((await g.send(owner, 'configureRoute', [OTHER_ROUTE, 0n, WINDOW])).error).toBe('InvalidRouteConfig');
    expect((await g.send(owner, 'configureRoute', [OTHER_ROUTE, CAP, 0n])).error).toBe('InvalidRouteConfig');
  });
});

describe('pausing', () => {
  it('an accepted attestation pauses the route for 24 hours', async () => {
    expect((await submit(att())).ok).toBe(true);
    expect(await pausedUntil()).toBe(g.now + DAY);
    expect(await g.read('isPaused', [ROUTE])).toBe(true);
    expect(await g.read('routeStatus', [ROUTE])).toBe(Status.PAUSED);
    expect((await g.send(bridge, 'onTokenOutflow', [ROUTE, 1n])).error).toBe('RoutePaused');
  });

  // Inclusive, to match the oracle's tiered thresholds: 64 is refused, 65 throttles.
  it('treats 65 as the inclusive threshold: 64 is refused, 65 accepts and throttles', async () => {
    expect((await submit(att({ riskScore: 64n }))).error).toBe('ScoreBelowThreshold');
    expect((await submit(att({ riskScore: 65n }))).ok).toBe(true);
    expect(await g.read('currentTier', [ROUTE])).toBe(Tier.THROTTLE);
  });

  it('accepts 100 and rejects anything above it', async () => {
    expect((await submit(att({ riskScore: 101n }))).error).toBe('InvalidScore');
    expect((await submit(att({ riskScore: 100n }))).ok).toBe(true);
  });

  it('pauses only the attested route, not the rest of the bridge', async () => {
    await g.send(owner, 'configureRoute', [OTHER_ROUTE, CAP, WINDOW]);
    await g.send(owner, 'setProtected', [bridge.address, OTHER_ROUTE, true]);
    await submit(att({ routeId: ROUTE }));
    expect(await g.read('isPaused', [ROUTE])).toBe(true);
    expect(await g.read('isPaused', [OTHER_ROUTE])).toBe(false);
    expect((await g.send(bridge, 'onTokenOutflow', [OTHER_ROUTE, 1n])).ok).toBe(true);
  });

  it('refuses an attestation for an unconfigured route', async () => {
    expect((await submit(att({ routeId: OTHER_ROUTE }))).error).toBe('RouteNotConfigured');
  });

  // A fresh attestation restarts the clock, so it can only extend a pause.
  it('a second attestation extends the pause rather than shortening it', async () => {
    await submit(att());
    const first = await pausedUntil();
    g.warp(HOUR);
    await submit(att());
    expect(await pausedUntil()).toBe(first + HOUR);
  });
});

// Each tier is at least as strict as the one below it, and an active tier
// only escalates. Every test here is one way the tiers used to go wrong.
describe('graduated tiers', () => {
  const outflow = (amount: bigint) => g.send(bridge, 'onTokenOutflow', [ROUTE, amount]);
  const tier = () => g.read<number>('currentTier', [ROUTE]);
  const route = () => g.read<{ tierExpiresAt: bigint; delayUntil: bigint; pausedUntil: bigint }>('getRoute', [ROUTE]);

  it.each([
    [64n, Tier.NONE],
    [65n, Tier.THROTTLE],
    [84n, Tier.THROTTLE],
    [85n, Tier.DELAY],
    [94n, Tier.DELAY],
    [95n, Tier.FREEZE],
  ])('score %s applies tier %s', async (riskScore, expected) => {
    await submit(att({ riskScore }));
    expect(await tier()).toBe(expected);
    expect(await g.read('isPaused', [ROUTE])).toBe(expected === Tier.FREEZE);
  });

  it('THROTTLE halves the window cap', async () => {
    await submit(att({ riskScore: 65n }));
    expect((await outflow(CAP / 2n)).ok).toBe(true);
    const over = await outflow(1n);
    expect(over.error).toBe('RateLimited');
    expect(over.errorArgs).toEqual([ROUTE, CAP / 2n + 1n, CAP / 2n]);
  });

  // Regression: DELAY once capped at 75% while THROTTLE capped at 50%, so a
  // riskier score loosened the limit.
  it('DELAY is at least as strict as THROTTLE', async () => {
    await submit(att({ riskScore: 85n }));
    g.warp(DELAY_WINDOW);
    expect((await outflow(CAP / 2n)).ok).toBe(true);
    expect((await outflow(1n)).error).toBe('RateLimited');
  });

  // Regression: DELAY once applied no delay at all.
  it('DELAY holds outflows above 10% of the cap for the review window', async () => {
    await submit(att({ riskScore: 85n }));
    const releaseAt = g.now + DELAY_WINDOW;
    const held = await outflow(CAP / 10n + 1n);
    expect(held.error).toBe('OutflowDelayed');
    expect(held.errorArgs).toEqual([ROUTE, CAP / 10n + 1n, releaseAt]);
    expect((await outflow(CAP / 10n)).ok).toBe(true); // small outflows still move
    g.warp(DELAY_WINDOW - 1n);
    expect((await outflow(CAP / 10n + 1n)).error).toBe('OutflowDelayed');
    g.warp(1n);
    expect((await outflow(CAP / 10n + 1n)).ok).toBe(true);
  });

  it('escalating from THROTTLE into DELAY opens the review window', async () => {
    await submit(att({ riskScore: 65n }));
    expect((await outflow(CAP / 10n + 1n)).ok).toBe(true);
    await submit(att({ riskScore: 85n }));
    expect((await outflow(CAP / 10n + 1n)).error).toBe('OutflowDelayed');
  });

  // A refresh must not let an oracle hold a route in review forever.
  it('a repeat DELAY attestation extends the tier but not the review window', async () => {
    await submit(att({ riskScore: 85n }));
    const { delayUntil } = await route();
    g.warp(DELAY_WINDOW / 2n);
    await submit(att({ riskScore: 90n }));
    expect((await route()).delayUntil).toBe(delayUntil);
    expect((await route()).tierExpiresAt).toBe(g.now + DAY);
  });

  // Regression: a lower-score attestation once replaced an active FREEZE.
  it.each([
    [95n, 65n],
    [95n, 85n],
    [85n, 65n],
  ])('an active tier from score %s is not downgraded by score %s', async (high, low) => {
    await submit(att({ riskScore: high }));
    const before = { tier: await tier(), ...(await route()) };
    g.warp(HOUR);
    expect((await submit(att({ riskScore: low }))).ok).toBe(true);
    expect({ tier: await tier(), ...(await route()) }).toEqual(before);
  });

  it('a lower tier applies once the higher one has expired', async () => {
    await submit(att({ riskScore: 95n }));
    g.warp(DAY);
    expect(await tier()).toBe(Tier.NONE);
    await submit(att({ riskScore: 65n }));
    expect(await tier()).toBe(Tier.THROTTLE);
  });

  it('every tier expires after 24 hours and the full cap returns', async () => {
    await submit(att({ riskScore: 85n }));
    g.warp(DAY - 1n);
    expect(await tier()).toBe(Tier.DELAY);
    g.warp(1n);
    expect(await tier()).toBe(Tier.NONE);
    expect((await outflow(CAP)).ok).toBe(true);
  });

  // Only `resume` lifts a tier early; reconfiguring a cap is not a back door.
  it('reconfiguring the route leaves an active tier in place', async () => {
    await submit(att({ riskScore: 85n }));
    await g.send(owner, 'configureRoute', [ROUTE, CAP, WINDOW]);
    expect(await tier()).toBe(Tier.DELAY);
    expect((await outflow(CAP / 10n + 1n)).error).toBe('OutflowDelayed');
  });

  it('resume clears the tier and the review window', async () => {
    await submit(att({ riskScore: 85n }));
    await g.send(owner, 'resume', [ROUTE]);
    expect(await tier()).toBe(Tier.NONE);
    // State, not just behaviour: a stale review clock is invisible to outflows
    // (entering DELAY always restarts it) but getRoute feeds the dashboard.
    const r = await g.read<{ tierExpiresAt: bigint; delayUntil: bigint; pausedUntil: bigint }>('getRoute', [ROUTE]);
    expect([r.tierExpiresAt, r.delayUntil, r.pausedUntil]).toEqual([0n, 0n, 0n]);
    expect((await outflow(CAP)).ok).toBe(true);
  });
});

// Every pause expires; nothing the oracle does can brick a route.
describe('expiry and escape hatches', () => {
  it('a pause lifts on its own after 24 hours', async () => {
    await submit(att());
    g.warp(DAY - 1n);
    expect((await g.send(bridge, 'onTokenOutflow', [ROUTE, 1n])).error).toBe('RoutePaused');
    g.warp(1n);
    expect(await g.read('isPaused', [ROUTE])).toBe(false);
    expect((await g.send(bridge, 'onTokenOutflow', [ROUTE, 1n])).ok).toBe(true);
  });

  it('the owner can resume early', async () => {
    await submit(att());
    expect((await g.send(owner, 'resume', [ROUTE])).ok).toBe(true);
    expect(await g.read('isPaused', [ROUTE])).toBe(false);
  });

  it('rotating the oracle stops the old key being able to pause', async () => {
    const a = att();
    const oldSig = await signAttestation(oracle, g.address, a);
    expect((await g.send(owner, 'setOracle', [attacker.address])).ok).toBe(true);
    const res = await submit(a, oldSig);
    expect(res.error).toBe('InvalidSigner');
    expect(res.errorArgs).toEqual([oracle.address]);
  });

  it('refuses a zero oracle on rotation', async () => {
    expect((await g.send(owner, 'setOracle', ['0x0000000000000000000000000000000000000000'])).error).toBe(
      'ZeroAddress'
    );
  });

  it.each([
    ['configureRoute', [OTHER_ROUTE, CAP, WINDOW]],
    ['setProtected', [attacker.address, ROUTE, true]],
    ['setOracle', [attacker.address]],
    ['resume', [ROUTE]],
  ] as const)('only the owner may call %s', async (fn, args) => {
    expect((await g.send(attacker, fn, args)).error).toBe('OwnableUnauthorizedAccount');
  });
});

// Replay-proof across routes, chains, contracts and time.
describe('attestation replay protection', () => {
  it('each nonce is single-use', async () => {
    const a = att();
    const sig = await signAttestation(oracle, g.address, a);
    expect((await submit(a, sig)).ok).toBe(true);
    await g.send(owner, 'resume', [ROUTE]);
    expect((await submit(a, sig)).error).toBe('NonceAlreadyUsed');
  });

  // Identical bytecode is deployed to four chains.
  it('a signature produced for another chain is rejected', async () => {
    const a = att();
    expect((await submit(a, await signAttestation(oracle, g.address, a, 42161))).error).toBe('InvalidSigner');
  });

  it('a signature produced for another guardian deployment is rejected', async () => {
    const a = att();
    const sig = await signAttestation(oracle, '0x000000000000000000000000000000000000dEaD', a);
    expect((await submit(a, sig)).error).toBe('InvalidSigner');
  });

  it('an attestation signed by anyone but the oracle is rejected', async () => {
    const a = att();
    const res = await submit(a, await signAttestation(attacker, g.address, a));
    expect(res.error).toBe('InvalidSigner');
    expect(res.errorArgs).toEqual([attacker.address]);
  });

  it('a signature cannot be reused with a different score', async () => {
    const a = att({ riskScore: 80n });
    const sig = await signAttestation(oracle, g.address, a);
    expect((await submit({ ...a, riskScore: 99n }, sig)).error).toBe('InvalidSigner');
  });

  it('an expired attestation is rejected', async () => {
    const a = att({ validUntil: g.now + 60n });
    const sig = await signAttestation(oracle, g.address, a);
    g.warp(61n);
    expect((await submit(a, sig)).error).toBe('AttestationExpired');
  });

  // Stops a signed-but-unsubmitted attestation being held and fired later.
  it('an attestation valid for longer than the TTL is rejected', async () => {
    expect((await submit(att({ validUntil: g.now + 601n }))).error).toBe('AttestationTtlTooLong');
    expect((await submit(att({ validUntil: g.now + 600n }))).ok).toBe(true);
  });

  it('a malleated signature (s -> n - s) is rejected', async () => {
    const a = att();
    const sig = hexToSignature(await signAttestation(oracle, g.address, a));
    const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const malleated = signatureToHex({
      r: sig.r,
      s: toHex(N - BigInt(sig.s), { size: 32 }),
      yParity: sig.yParity === 0 ? 1 : 0,
    });
    expect((await submit(a, malleated)).error).toBe('ECDSAInvalidSignatureS');
  });

  it('a malformed signature is rejected rather than misparsed', async () => {
    expect((await submit(att(), '0x1234')).error).toBe('ECDSAInvalidSignatureLength');
  });
});

describe('route status for the dashboard', () => {
  it('reports ACTIVE, RATE_LIMITED and PAUSED in turn', async () => {
    expect(await g.read('routeStatus', [ROUTE])).toBe(Status.ACTIVE);
    await g.send(bridge, 'onTokenOutflow', [ROUTE, CAP]);
    expect(await g.read('routeStatus', [ROUTE])).toBe(Status.RATE_LIMITED);
    await submit(att());
    expect(await g.read('routeStatus', [ROUTE])).toBe(Status.PAUSED);
  });
});

describe('gas', () => {
  it('keeps the hot path cheap enough to sit inside every withdrawal', async () => {
    await g.send(bridge, 'onTokenOutflow', [ROUTE, 1n]); // warm the slots
    const outflow = await g.send(bridge, 'onTokenOutflow', [ROUTE, 1n]);
    const attest = await submit(att());
    expect(outflow.gas).toBeLessThan(100_000n);
    expect(attest.gas).toBeLessThan(90_000n);
    console.log(`gas — onTokenOutflow (warm): ${outflow.gas}, submitAttestation: ${attest.gas}`);
  });
});

// Regression: concurrent calls on one VM corrupted ethereumjs's state trie
// ("Stack underflow"). GuardianVM now serialises every operation.
describe('GuardianVM concurrency', () => {
  it('survives many overlapping reads and writes', async () => {
    const results = await Promise.all([
      ...Array.from({ length: 10 }, () => g.read('routeStatus', [ROUTE])),
      ...Array.from({ length: 5 }, () => g.send(bridge, 'onTokenOutflow', [ROUTE, 1n])),
      ...Array.from({ length: 10 }, () => g.read('isPaused', [ROUTE])),
    ]);
    expect(results).toHaveLength(25);
    expect((await g.read<{ outflowInWindow: bigint }>('getRoute', [ROUTE])).outflowInWindow).toBe(5n);
  });
});
