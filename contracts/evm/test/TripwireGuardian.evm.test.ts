// The guardian executed in a real EVM, against the bytecode compile.mjs just
// produced. Each describe block corresponds to one invariant in the contract's
// header comment, and each test tries to break it.

import { beforeEach, describe, expect, it } from 'vitest';
import { hexToSignature, keccak256, signatureToHex, toHex, type Hex } from 'viem';
import {
  CHAIN_ID,
  Guardian,
  attacker,
  bridge,
  oracle,
  owner,
  signAttestation,
  stranger,
  type Attestation,
} from './evm.js';

const ROUTE = keccak256(toHex('eth:arb:USDC'));
const OTHER_ROUTE = keccak256(toHex('base:op:WETH'));
const CAP = 1_000_000n;
const WINDOW = 3600n;
const HOUR = 3600n;

enum Status { ACTIVE, RATE_LIMITED, PAUSED }
enum Tier { NONE, HIGH, CRITICAL }

let g: Guardian;
let nonce = 0n;

beforeEach(async () => {
  g = await Guardian.deploy();
  expect((await g.send(owner, 'configureRoute', [ROUTE, CAP, WINDOW])).ok).toBe(true);
  expect((await g.send(owner, 'setProtected', [bridge.address, true])).ok).toBe(true);
});

const att = (over: Partial<Attestation> = {}): Attestation => ({
  routeId: ROUTE,
  riskScore: 80n,
  validUntil: g.now + 300n,
  nonce: ++nonce,
  ...over,
});

async function submit(a: Attestation, sig?: Hex) {
  const signature = sig ?? (await signAttestation(oracle, g.address, a));
  return g.send(stranger, 'submitAttestation', [a.routeId, a.riskScore, a.validUntil, a.nonce, signature]);
}

const route = () => g.read<{ pausedUntil: bigint; tier: number; outflowInWindow: bigint }>('getRoute', [ROUTE]);

// --------------------------------------------------------------------------

describe('deployment', () => {
  it('rejects a zero oracle, so the guardian cannot be deployed un-pausable', async () => {
    expect(await Guardian.deployExpectingRevert('0x0000000000000000000000000000000000000000')).toBe('ZeroAddress');
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
    const { hashTypedData } = await import('viem');
    const offChain = hashTypedData({
      domain: { name: 'TripwireGuardian', version: '1', chainId: CHAIN_ID, verifyingContract: g.address },
      types: {
        Attestation: [
          { name: 'routeId', type: 'bytes32' },
          { name: 'riskScore', type: 'uint256' },
          { name: 'validUntil', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
        ],
      },
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
    const res = await g.send(attacker, 'onTokenOutflow', [ROUTE, 1n]);
    expect(res.error).toBe('NotProtected');
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

describe('tiered pausing', () => {
  it('HIGH risk (76-90) pauses the route for the 4-hour review cooldown', async () => {
    expect((await submit(att({ riskScore: 80n }))).ok).toBe(true);
    const r = await route();
    expect(r.tier).toBe(Tier.HIGH);
    expect(r.pausedUntil).toBe(g.now + 4n * HOUR);
    expect(await g.read('isPaused', [ROUTE])).toBe(true);
    expect(await g.read('routeStatus', [ROUTE])).toBe(Status.PAUSED);
    expect((await g.send(bridge, 'onTokenOutflow', [ROUTE, 1n])).error).toBe('RoutePaused');
  });

  it('CRITICAL risk (91-100) triggers the 24-hour lockdown', async () => {
    expect((await submit(att({ riskScore: 95n }))).ok).toBe(true);
    const r = await route();
    expect(r.tier).toBe(Tier.CRITICAL);
    expect(r.pausedUntil).toBe(g.now + 24n * HOUR);
  });

  it('treats the thresholds as strict: 75 is refused, 76 is HIGH, 90 is HIGH, 91 is CRITICAL', async () => {
    expect((await submit(att({ riskScore: 75n }))).error).toBe('ScoreBelowThreshold');
    expect((await submit(att({ riskScore: 76n }))).ok).toBe(true);
    expect((await route()).tier).toBe(Tier.HIGH);

    g = await Guardian.deploy();
    await g.send(owner, 'configureRoute', [ROUTE, CAP, WINDOW]);
    expect((await submit(att({ riskScore: 90n }))).ok).toBe(true);
    expect((await route()).tier).toBe(Tier.HIGH);
    expect((await submit(att({ riskScore: 91n }))).ok).toBe(true);
    expect((await route()).tier).toBe(Tier.CRITICAL);
  });

  it('rejects a score above 100', async () => {
    expect((await submit(att({ riskScore: 101n }))).error).toBe('InvalidScore');
  });

  it('pauses only the attested route, not the rest of the bridge', async () => {
    await g.send(owner, 'configureRoute', [OTHER_ROUTE, CAP, WINDOW]);
    await submit(att({ routeId: ROUTE }));
    expect(await g.read('isPaused', [ROUTE])).toBe(true);
    expect(await g.read('isPaused', [OTHER_ROUTE])).toBe(false);
    expect((await g.send(bridge, 'onTokenOutflow', [OTHER_ROUTE, 1n])).ok).toBe(true);
  });

  it('refuses an attestation for an unconfigured route', async () => {
    expect((await submit(att({ routeId: OTHER_ROUTE }))).error).toBe('RouteNotConfigured');
  });
});

// A pause only ever moves forward.
describe('pause monotonicity', () => {
  it('a HIGH attestation cannot shorten an active CRITICAL lockdown', async () => {
    await submit(att({ riskScore: 95n }));
    const lockdownEnd = (await route()).pausedUntil;
    g.warp(HOUR);
    expect((await submit(att({ riskScore: 80n }))).ok).toBe(true);
    const r = await route();
    expect(r.pausedUntil).toBe(lockdownEnd);
    expect(r.tier).toBe(Tier.CRITICAL);
  });

  it('a CRITICAL attestation escalates an active HIGH pause', async () => {
    await submit(att({ riskScore: 80n }));
    g.warp(HOUR);
    await submit(att({ riskScore: 95n }));
    const r = await route();
    expect(r.tier).toBe(Tier.CRITICAL);
    expect(r.pausedUntil).toBe(g.now + 24n * HOUR);
  });
});

// Every pause expires; nothing the oracle does can brick a route.
describe('expiry and escape hatches', () => {
  it('a pause lifts on its own when the cooldown ends', async () => {
    await submit(att({ riskScore: 80n }));
    g.warp(4n * HOUR - 1n);
    expect((await g.send(bridge, 'onTokenOutflow', [ROUTE, 1n])).error).toBe('RoutePaused');
    g.warp(1n);
    expect(await g.read('isPaused', [ROUTE])).toBe(false);
    expect((await g.send(bridge, 'onTokenOutflow', [ROUTE, 1n])).ok).toBe(true);
  });

  it('the owner can resume early', async () => {
    await submit(att({ riskScore: 95n }));
    expect((await g.send(owner, 'resume', [ROUTE])).ok).toBe(true);
    expect(await g.read('isPaused', [ROUTE])).toBe(false);
    expect((await route()).tier).toBe(Tier.NONE);
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
    expect((await g.send(owner, 'setOracle', ['0x0000000000000000000000000000000000000000'])).error).toBe('ZeroAddress');
  });

  it.each([
    ['configureRoute', [OTHER_ROUTE, CAP, WINDOW]],
    ['setProtected', [attacker.address, true]],
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
    const arbitrumSig = await signAttestation(oracle, g.address, a, 42161);
    expect((await submit(a, arbitrumSig)).error).toBe('InvalidSigner');
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

  // Tampering with any signed field changes the digest.
  it('a signature cannot be reused with a raised score', async () => {
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

  // OpenZeppelin rejects the upper-half s, so no second valid signature exists
  // for an attestation that was already accepted.
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
    // Recorded, not guessed: see the README table. Ceilings leave headroom
    // for compiler drift while still failing on a real regression.
    expect(outflow.gas).toBeLessThan(40_000n);
    expect(attest.gas).toBeLessThan(90_000n);
    console.log(`gas — onTokenOutflow (warm): ${outflow.gas}, submitAttestation: ${attest.gas}`);
  });
});
