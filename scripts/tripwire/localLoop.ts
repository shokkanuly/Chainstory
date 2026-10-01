// scripts/tripwire/localLoop.ts
//
// Watcher → attestor → guardian, end to end, against the real TripwireGuardian
// bytecode in an in-process EVM. Runs in CI (localLoop.test.ts) and as
// `npm run tripwire:demo:local`. Demo keys, a local chain: nothing here
// touches a real network. Stage 4 swaps the feeds and the guardian port for
// testnet RPCs and keeps everything else.

import { formatUnits, keccak256, toHex, type Hex } from 'viem';
import artifact from '../../src/tripwire/guardian.artifact.js';
import { GuardianVM, LOCAL_CHAIN_ID, actors, type CallResult } from '../../src/tripwire/guardianVM.js';
import { ResponseTier } from '../../src/tripwire/onChain.js';
import type { RouteBaseline } from '../../src/tripwire/types.js';
import { FLAG_LIST_NAME, lookupFlaggedAddress } from '../../src/services/preventiveScamScanner.js';
import { ATTACK_STEPS, DRAIN_CONTRACT, DRAIN_CONTRACT_FACTS, USDC, playStep } from './attack.js';
import { Attestor, type AttestationOutcome, type GuardianPort } from './attest.js';
import { MemoryFeed, type BurnEvent, type ReleaseEvent } from './events.js';
import { Watcher, type Observation } from './watch.js';
import demo from './testnet/contracts.artifact.js';
import { ReleaseDecision, releaseDecision, releaseMinimumTier, signReleaseReview, type ReleaseReview } from './review.js';

export const ROUTE_NAME = 'sepolia:base-sepolia:USDC';
export const ROUTE_ID = keccak256(toHex(ROUTE_NAME));
/** Per-hour outflow cap. THROTTLE and DELAY halve it; DELAY holds anything above a tenth of it. */
export const CAP = 2_000_000n * USDC;
const WINDOW = 3600n;
const START = 1_780_000_000n;
/** Minutes between attack steps. */
const STEP_SECONDS = 5 * 60;

/**
 * The route's usual behaviour. A running watcher builds this from observed
 * history; the demo starts from a fixed one so its numbers are reproducible.
 */
const BASELINE: RouteBaseline = {
  route: ROUTE_NAME,
  windowHours: 24,
  sampleSize: 450,
  medianTransferUsd: 15_000,
  p95TransferUsd: 85_000,
  rollingTvlUsd: 25_000_000,
  computedAt: Number(START) - 300,
};

export interface PayoutResult extends Observation {
  attestation: AttestationOutcome;
  review: CallResult;
  /** The vault paying the release out, after the attestor has acted. */
  outflow: CallResult;
}

export interface StepResult {
  title: string;
  payouts: PayoutResult[];
  tierAfter: ResponseTier;
}

export async function runLocalLoop(onStep?: (step: StepResult) => void): Promise<StepResult[]> {
  const guardian = await GuardianVM.deploy(artifact, { start: START, oracle: actors.oracle.address });
  const token = await guardian.deployContract(demo.DemoUSDC, [actors.owner.address]);
  const vault = await guardian.deployContract(demo.ProtectedVault, [actors.owner.address, token.address, guardian.address, ROUTE_ID]);
  await guardian.send(actors.owner, 'configureRoute', [ROUTE_ID, CAP, WINDOW]);
  await guardian.send(actors.owner, 'setProtected', [vault.address, true]);
  await guardian.sendContract(token, actors.owner, 'mint', [vault.address, 20_000_000n * USDC]);

  const port: GuardianPort = {
    address: guardian.address,
    chainId: LOCAL_CHAIN_ID,
    currentTier: (routeId) => guardian.read<ResponseTier>('currentTier', [routeId]),
    // Submission is permissionless: a relayer, not the signer, sends it.
    submitAttestation: (a, signature) =>
      guardian.send(actors.relayer, 'submitAttestation', [a.routeId, a.riskScore, a.validUntil, a.nonce, signature]),
  };

  const now = () => Number(guardian.now);
  const ingress = new MemoryFeed<BurnEvent>();
  const egress = new MemoryFeed<ReleaseEvent>();
  const watcher = new Watcher({
    route: ROUTE_NAME,
    chain: 'base',
    token: 'USDC',
    decimals: 6,
    bridge: vault.address,
    ingress,
    egress,
    baseline: BASELINE,
    screening: {
      isFlagged: (a) => lookupFlaggedAddress(a) !== null,
      describe: (a) => (lookupFlaggedAddress(a) ? `${FLAG_LIST_NAME}: ${lookupFlaggedAddress(a)?.name}` : undefined),
    },
    contractFacts: async (a) => (a.toLowerCase() === DRAIN_CONTRACT ? DRAIN_CONTRACT_FACTS : null),
    now,
    // Only this closed synthetic fixture can establish absence immediately.
    // A live bridge adapter must verify completeness and source-chain finality.
    verifySource: async (_release, burned) => burned === null
      ? { status: 'invalid', reason: 'The complete synthetic source fixture contains no burn for this message.' }
      : { status: 'verified', amount: burned },
  });
  let nonce = 0n;
  const attestor = new Attestor(actors.oracle, port, { now, nextNonce: () => ++nonce });

  const results: StepResult[] = [];
  for (const [i, step] of ATTACK_STEPS.entries()) {
    if (i > 0) guardian.warp(STEP_SECONDS);
    for (const release of playStep(step, now(), { ingress, egress })) {
      const requested = await guardian.sendContract(vault, actors.owner, 'requestRelease', [release.messageId, release.recipient, release.amount]);
      if (!requested.ok) throw new Error(`Local release request failed: ${requested.error}`);
    }

    const payouts: PayoutResult[] = [];
    for (const observation of await watcher.tick()) {
      const attestation = await attestor.handle(ROUTE_ID, observation.assessment);
      if (attestation.action === 'rejected' || attestation.action === 'unavailable') throw new Error('Guardian protection is unavailable or rejected; the release remains pending.');
      const releaseReview: ReleaseReview = {
        messageId: observation.release.messageId, routeId: ROUTE_ID, token: token.address,
        recipient: observation.release.recipient, amount: observation.release.amount,
        decision: releaseDecision(observation), minimumTier: releaseMinimumTier(observation), validUntil: guardian.now + 300n, nonce: ++nonce,
      };
      const signature = await signReleaseReview(actors.oracle, vault.address, releaseReview, LOCAL_CHAIN_ID);
      const review = await guardian.sendContract(vault, actors.relayer, 'reviewRelease', [
        releaseReview.messageId, releaseReview.decision, releaseReview.minimumTier, releaseReview.validUntil, releaseReview.nonce, signature,
      ]);
      if (!review.ok) throw new Error(`Local release review failed: ${review.error}`);
      const outflow = await guardian.sendContract(vault, actors.relayer, 'executeRelease', [observation.release.messageId]);
      await watcher.acknowledge(observation.release.messageId);
      payouts.push({ ...observation, attestation, review, outflow });
    }
    const result: StepResult = {
      title: step.title,
      payouts,
      tierAfter: Number(await guardian.read<ResponseTier>('currentTier', [ROUTE_ID])) as ResponseTier,
    };
    results.push(result);
    onStep?.(result);
  }
  return results;
}

// --- printing -------------------------------------------------------------------

const usdc = (units: bigint) => `${Number(formatUnits(units, 6)).toLocaleString('en-US')} USDC`;
const short = (a: Hex) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function describeStep(step: StepResult, index: number): string[] {
  const lines = [`[${index}] ${step.title}`];
  for (const p of step.payouts) {
    const a = p.assessment;
    const burn = p.burned === null ? 'SOURCE UNKNOWN' : p.burned === p.release.amount ? 'burn ✓' : p.burned === 0n ? 'NO BURN' : `burn ${usdc(p.burned)}`;
    const attest =
      p.attestation.action === 'skipped' || p.attestation.action === 'unavailable'
        ? `no attestation (${p.attestation.reason})`
        : `${p.attestation.action === 'submitted' ? 'attested' : 'REJECTED'} ${p.attestation.attestation.riskScore} → ${ResponseTier[p.attestation.tier]}` +
          (p.attestation.result.gas ? `, gas ${p.attestation.result.gas.toLocaleString('en-US')}` : '');
    const paid = p.outflow.ok ? 'paid out' : `blocked: ${p.outflow.error}`;
    lines.push(`    ${usdc(p.release.amount)} → ${short(p.release.recipient)} · ${burn}`);
    lines.push(`      score ${a.score === null ? '—' : a.score.toFixed(2)} ${a.verdict} · ${attest}`);
    lines.push(`      signed release review: ${ReleaseDecision[releaseDecision(p)]} · ${p.review.ok ? 'accepted' : 'rejected'} · ${paid}`);
    const why = a.signals.filter((s) => s.score >= 0.9).map((s) => s.reason);
    for (const reason of why) lines.push(`      ↳ ${reason}`);
  }
  lines.push(`    guardian tier: ${ResponseTier[step.tierAfter]}`);
  return lines;
}
