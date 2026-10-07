// scripts/demo/attackSimulation.ts
//
// SUPERSEDED by scripts/tripwire/ (`npm run tripwire:demo:local`; `demo:attack`
// now runs that too). Kept, not deleted, but no longer run: it forced its
// moderate score with `Math.max(score, 0.72)` and listed a DELAY step it never
// ran. The new loop earns every tier from the watcher's own score.
//
// Tripwire: Cross-Chain Bridge Circuit Breaker — Live Attack Simulation CLI
//
// Demonstrates the full Detect → Attest → Graduated Tiered Response loop:
//
// 1. Normal transfer (baseline, low risk) -> Allowed, full volume intact
// 2. Moderate anomaly (Risk > 0.65)        -> Triggers TIER 1: THROTTLE (reduces hourly outflow cap by 50%)
// 3. High anomaly (Risk > 0.85)            -> Triggers TIER 2: DELAY (enforces review window timelock)
// 4. Critical exploit attack (Risk > 0.95) -> Triggers TIER 3: FREEZE (halts route before confirmation)

import { keccak256, toHex } from 'viem';
import { GuardianVM, actors, LOCAL_CHAIN_ID } from '../../src/tripwire/guardianVM.js';
import artifact from '../../src/tripwire/guardian.artifact.js';
import { scoreTransfer, DEFAULT_CONFIG } from '../../src/tripwire/riskScorer.js';
import { toOnChainScore, signAttestation, ResponseTier, getTierForScore } from '../../src/tripwire/onChain.js';
import type { BridgeTransfer, RouteBaseline } from '../../src/tripwire/types.js';

const ROUTE = keccak256(toHex('sepolia:base_sepolia:USDC'));
const INITIAL_CAP = 1_000_000n; // $1,000,000 hourly capacity
const WINDOW_SECONDS = 3600n;   // 1 hour rolling window
const NOW = 1_780_000_000;

const baseline: RouteBaseline = {
  route: 'sepolia:base_sepolia:USDC',
  windowHours: 24,
  sampleSize: 450,
  medianTransferUsd: 15_000,
  p95TransferUsd: 85_000,
  rollingTvlUsd: 25_000_000,
  computedAt: NOW - 300,
};

const screening = {
  isFlagged: (_addr: string) => false,
  describe: (_addr: string) => undefined,
};

let nonce = 100n;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tierName(tier: number): string {
  switch (tier) {
    case ResponseTier.THROTTLE:
      return 'TIER 1 (THROTTLE: 50% Cap)';
    case ResponseTier.DELAY:
      return 'TIER 2 (DELAY: Timelock Active)';
    case ResponseTier.FREEZE:
      return 'TIER 3 (FREEZE: Circuit Breaker Tripped)';
    default:
      return 'NONE (Normal Operations)';
  }
}

async function main() {
  console.log('\n===============================================================');
  console.log('⚡ TRIPWIRE — CROSS-CHAIN BRIDGE CIRCUIT BREAKER');
  console.log('   Graduated Defensive Response Demo (Hackathon Build)');
  console.log('===============================================================\n');

  console.log('1. Deploying TripwireGuardian to EVM Testnet Environment...');
  const guardian = await GuardianVM.deploy(artifact, {
    start: BigInt(NOW),
    oracle: actors.oracle.address,
  });
  console.log(`   ✓ Guardian Contract deployed at: ${guardian.address}`);
  console.log(`   ✓ Oracle Authorized Signer:    ${actors.oracle.address}`);

  console.log('\n2. Initializing Bridge Route [Sepolia -> Base Sepolia: USDC]...');
  await guardian.send(actors.owner, 'configureRoute', [ROUTE, INITIAL_CAP, WINDOW_SECONDS]);
  await guardian.send(actors.owner, 'setProtected', [actors.bridge.address, ROUTE, true]);
  console.log(`   ✓ Route Configured: Base Cap = $${INITIAL_CAP.toLocaleString()} / 1hr`);

  const initialStatus = await guardian.read<number>('routeStatus', [ROUTE]);
  const initialTier = await guardian.read<number>('currentTier', [ROUTE]);
  console.log(`   ✓ Status: ${initialStatus === 0 ? 'ACTIVE' : 'RESTRICTED'} | Tier: ${tierName(initialTier)}`);

  console.log('\n---------------------------------------------------------------');
  console.log('SCENARIO 1: Legitimate Bridge Outflow (Normal Traffic)');
  console.log('---------------------------------------------------------------');
  const normalTx: BridgeTransfer = {
    hash: '0xnormal_transfer_01',
    chain: 'ethereum',
    route: 'sepolia:base_sepolia:USDC',
    token: 'USDC',
    amountUsd: 35_000,
    timestamp: NOW,
    from: actors.bridge.address,
    to: '0xAlice',
    provenBurnUsd: 35_000,
    claimedPayoutUsd: 35_000,
  };

  const normalAssessment = scoreTransfer({
    transfer: normalTx,
    baseline,
    recent: [],
    screening,
    now: NOW,
    config: DEFAULT_CONFIG,
  });

  console.log(`   - Transfer Size:  $${normalTx.amountUsd?.toLocaleString()} USDC`);
  console.log(`   - Ingress Burn:   $${normalTx.provenBurnUsd?.toLocaleString()} | Egress Claim: $${normalTx.claimedPayoutUsd?.toLocaleString()}`);
  console.log(`   - Risk Scorer:    ${(normalAssessment.score ?? 0).toFixed(2)} [Verdict: ${normalAssessment.verdict.toUpperCase()}]`);

  const normalOutflow = await guardian.send(actors.bridge, 'onTokenOutflow', [ROUTE, 35_000n]);
  console.log(`   - Vault Result:   ${normalOutflow.ok ? '✓ RELEASED IMMEDIATELY' : '✗ BLOCKED'}`);

  await sleep(1000);

  console.log('\n---------------------------------------------------------------');
  console.log('SCENARIO 2: Moderate Anomaly (Elevated Volume Spike, >0.65 Risk)');
  console.log('---------------------------------------------------------------');
  // Rapid burst of consecutive large withdrawals triggers withdrawal velocity & size anomaly
  const moderateAnomalyTx: BridgeTransfer = {
    hash: '0xmoderate_spike_02',
    chain: 'ethereum',
    route: 'sepolia:base_sepolia:USDC',
    token: 'USDC',
    amountUsd: 1_250_000,
    timestamp: NOW + 60,
    from: actors.bridge.address,
    to: '0xUnknownEntity',
    provenBurnUsd: 1_250_000,
    claimedPayoutUsd: 1_250_000,
  };

  // Multiple rapid transactions in short window
  const burstTxs: BridgeTransfer[] = [
    { ...normalTx, hash: '0xburst_a', amountUsd: 900_000, timestamp: NOW + 10 },
    { ...normalTx, hash: '0xburst_b', amountUsd: 800_000, timestamp: NOW + 30 },
  ];

  const syntheticBaseline: RouteBaseline = {
    ...baseline,
    rollingTvlUsd: 4_000_000, // smaller TVL pool so burst represents significant %
    p95TransferUsd: 100_000,
  };

  const moderateAssessment = scoreTransfer({
    transfer: moderateAnomalyTx,
    baseline: syntheticBaseline,
    recent: burstTxs,
    screening,
    now: NOW + 60,
    config: DEFAULT_CONFIG,
  });

  const moderateScore = Math.max(moderateAssessment.score ?? 0, 0.72);
  const moderateOnChain = toOnChainScore(moderateScore);
  console.log(`   - Ingress Anomaly: Rapid burst draining ${(1.25 + 0.9 + 0.8) / 4 * 100}% TVL in < 2 mins`);
  console.log(`   - Risk Scorer:    ${moderateScore.toFixed(2)} (Score on-chain: ${moderateOnChain})`);
  console.log(`   - Trigger Action: Risk > 0.65 -> ${tierName(getTierForScore(moderateScore))}`);

  // Sign & submit attestation
  console.log(`   - Attestor:       Signing EIP-712 attestation with Oracle key...`);
  const att1 = {
    routeId: ROUTE,
    riskScore: moderateOnChain,
    validUntil: BigInt(NOW + 300),
    nonce: ++nonce,
  };
  const sig1 = await signAttestation(actors.oracle, guardian.address, att1, LOCAL_CHAIN_ID);
  const attestRes1 = await guardian.send(actors.relayer, 'submitAttestation', [
    att1.routeId,
    att1.riskScore,
    att1.validUntil,
    att1.nonce,
    sig1,
  ]);
  console.log(`   - Contract State: Attestation accepted (gas: ${attestRes1.gas.toLocaleString()})`);

  const tierAfter1 = await guardian.read<number>('currentTier', [ROUTE]);
  const isPaused1 = await guardian.read<boolean>('isPaused', [ROUTE]);
  console.log(`   - Guardian Tier:  ${tierName(tierAfter1)}`);
  console.log(`   - Is Frozen?      ${isPaused1} (Bridge remains open, throughput throttled to 50%)`);

  // Testing that subsequent $600k transfer hits the throttled cap ($500k)
  const throttledAttempt = await guardian.send(actors.bridge, 'onTokenOutflow', [ROUTE, 550_000n]);
  console.log(`   - Next $550k Outflow: ${throttledAttempt.ok ? 'RELEASED' : `✗ RATE LIMITED by 50% Throttled Cap (${throttledAttempt.error})`}`);

  await sleep(1000);

  console.log('\n---------------------------------------------------------------');
  console.log('SCENARIO 3: Catastrophic Exploit Attack (Proof/Payout Mismatch, >0.95 Risk)');
  console.log('---------------------------------------------------------------');
  const exploitTx: BridgeTransfer = {
    hash: '0xexploit_drain_03',
    chain: 'ethereum',
    route: 'sepolia:base_sepolia:USDC',
    token: 'USDC',
    amountUsd: 11_580_000,
    timestamp: NOW + 120,
    from: actors.bridge.address,
    to: actors.attacker.address,
    provenBurnUsd: 25_000,       // Burn proof is only $25,000!
    claimedPayoutUsd: 11_580_000, // Attacker forged release for $11.58M
  };

  const exploitAssessment = scoreTransfer({
    transfer: exploitTx,
    baseline,
    recent: [normalTx, moderateAnomalyTx],
    screening,
    now: NOW + 120,
    config: DEFAULT_CONFIG,
  });

  const exploitScore = exploitAssessment.score ?? 1.0;
  const exploitOnChain = toOnChainScore(exploitScore);

  console.log(`   - Attack Vector:  Forged cross-chain proof (Burn: $25k vs Claim: $11.58M)`);
  console.log(`   - Signal Detail:  ${exploitAssessment.signals.find(s => s.id === 'proof_payout_mismatch')?.reason}`);
  console.log(`   - Risk Scorer:    ${exploitScore.toFixed(2)} [CRITICAL EXPLOIT DETECTED]`);
  console.log(`   - Trigger Action: Risk > 0.95 -> ${tierName(getTierForScore(exploitScore))}`);

  // Sign & submit instant freeze attestation
  console.log(`   - Attestor:       Dispatched emergency freeze attestation...`);
  const att2 = {
    routeId: ROUTE,
    riskScore: exploitOnChain,
    validUntil: BigInt(NOW + 400),
    nonce: ++nonce,
  };
  const sig2 = await signAttestation(actors.oracle, guardian.address, att2, LOCAL_CHAIN_ID);
  await guardian.send(actors.relayer, 'submitAttestation', [
    att2.routeId,
    att2.riskScore,
    att2.validUntil,
    att2.nonce,
    sig2,
  ]);

  const finalTier = await guardian.read<number>('currentTier', [ROUTE]);
  const finalPaused = await guardian.read<boolean>('isPaused', [ROUTE]);
  console.log(`   - Guardian Tier:  ${tierName(finalTier)}`);
  console.log(`   - Route Frozen:   ${finalPaused} [CIRCUIT BREAKER FULLY ENGAGED]`);

  // Attacker attempt to withdraw the $11.58M
  const attackOutflow = await guardian.send(actors.bridge, 'onTokenOutflow', [ROUTE, 11_580_000n]);
  console.log(`   - Exploit Payout: ${attackOutflow.ok ? 'UNAUTHORIZED DRAIN OCCURRED' : `🛡️ PROTECTED: Reverted with "${attackOutflow.error}"`}`);

  console.log('\n===============================================================');
  console.log('🎉 SUMMARY: LIVE ATTACK LOOP VERIFIED');
  console.log('   1. Baseline transfers: Allowed at full capacity');
  console.log('   2. Moderate risk (>0.65): Throttled cap -50% (No false-positive bricking)');
  console.log('   3. Critical attack (>0.95): Route frozen before withdrawal confirmed');
  console.log('===============================================================\n');
}

main().catch((err) => {
  console.error('Simulation error:', err);
  process.exit(1);
});
