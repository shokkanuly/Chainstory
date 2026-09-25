// The guardian executed in a real EVM. Each describe block corresponds to one
// invariant in the contract's header comment, and each test tries to break it.

import { beforeEach, describe, expect, it } from 'vitest';
import { hashTypedData, hexToSignature, keccak256, signatureToHex, toHex, type Hex } from 'viem';
import { compileGuardian } from '../compile.mjs';
import { attestationDomain, ATTESTATION_TYPES } from '../../../src/tripwire/onChain.js';
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

enum Status { ACTIVE, RATE_LIMITED, PAUSED }

let g: GuardianVM;
let nonce = 0n;

beforeEach(async () => {
  g = await deployGuardian();
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

  // Inclusive, to match the oracle's own `score >= 0.75` rule.
  it('treats 75 as the inclusive threshold: 74 is refused, 75 pauses', async () => {
    expect((await submit(att({ riskScore: 74n }))).error).toBe('ScoreBelowThreshold');
    expect((await submit(att({ riskScore: 75n }))).ok).toBe(true);
  });

  it('accepts 100 and rejects anything above it', async () => {
    expect((await submit(att({ riskScore: 101n }))).error).toBe('InvalidScore');
    expect((await submit(att({ riskScore: 100n }))).ok).toBe(true);
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

  // A fresh attestation restarts the clock, so it can only extend a pause.
  it('a second attestation extends the pause rather than shortening it', async () => {
    await submit(att());
    const first = await pausedUntil();
    g.warp(HOUR);
    await submit(att());
    expect(await pausedUntil()).toBe(first + HOUR);
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
    expect(outflow.gas).toBeLessThan(40_000n);
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
