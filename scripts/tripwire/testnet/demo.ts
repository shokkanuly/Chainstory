// scripts/tripwire/testnet/demo.ts — `npm run tripwire:demo:sepolia`
//
// The four-step attack against the deployed contracts, on Sepolia. Every
// transaction is printed with its Etherscan link. Contract facts come from
// Retold's own check (fetchContractIntel), through the explorer proxy's
// handler run in-process with the key from .env.

import type { Hex } from 'viem';
import { inProcessExplorer } from '../../../server/explorerTransport.js';
import { setExplorerTransport } from '../../../src/services/apiClient.js';
import { fetchContractIntel } from '../../../src/services/contractIntel.js';
import { ResponseTier } from '../../../src/tripwire/onChain.js';
import { summariseContract } from '../../../src/tripwire/contractSummary.js';
import type { ContractRiskSummary } from '../../../src/tripwire/types.js';
import { USDC } from '../attack.js';
import { addressLink, connect, loadConfig, readDeployment, runTestnetDemo, txLink, type TestnetStep } from './sepolia.js';

const cfg = loadConfig();
if (!cfg.etherscanKey) {
  throw new Error('ETHERSCAN_API_KEY is missing from .env. The watcher needs it to read contract facts; without them steps 1 and 2 cannot escalate.');
}
setExplorerTransport(inProcessExplorer({ ETHERSCAN_API_KEY: cfg.etherscanKey }));
const c = await connect(cfg);
const d = readDeployment(cfg);
const drain = d.contracts.DrainProxy.address;

const cache = new Map<string, ContractRiskSummary | null>();
async function facts(address: Hex): Promise<ContractRiskSummary | null> {
  const k = address.toLowerCase();
  if (!cache.has(k)) cache.set(k, summariseContract(await fetchContractIntel(address, 'sepolia')));
  return cache.get(k) ?? null;
}

console.log('\nTripwire — live on Sepolia: watch → score → attest → guardian');
console.log(`Guardian ${addressLink(d.contracts.TripwireGuardian.address)}`);
console.log(`Vault    ${addressLink(d.contracts.ProtectedVault.address)}\n`);

// The explorer indexes a new contract's creation a little after it lands.
process.stdout.write('Reading the attacker contract’s facts from the explorer');
let drainFacts = await facts(drain);
for (let i = 0; i < 12 && (drainFacts?.ageDays == null || drainFacts.isVerified === null); i++) {
  process.stdout.write('.');
  await new Promise((r) => setTimeout(r, 15_000));
  cache.delete(drain.toLowerCase());
  drainFacts = await facts(drain);
}
console.log(`\n  ${drain}: ${JSON.stringify({ verified: drainFacts?.isVerified, ageDays: drainFacts?.ageDays, upgradeable: drainFacts?.isUpgradeable })}\n`);

const usdc = (n: bigint) => `${(n / USDC).toLocaleString('en-US')} tdUSDC`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function print(step: TestnetStep, i: number) {
  console.log(`\n[${i}] ${step.title}`);
  for (const p of step.payouts) {
    const attest =
      p.attestation.action === 'skipped' || p.attestation.action === 'unavailable'
        ? `no attestation (${p.attestation.reason})`
        : `${p.attestation.action === 'submitted' ? 'attested' : 'REJECTED'} ${p.attestation.attestation.riskScore} → ${ResponseTier[p.attestation.tier]}`;
    console.log(`    ${usdc(p.amount)} → ${short(p.recipient)} · ${p.burned === null ? 'SOURCE UNKNOWN' : p.burned === p.amount ? 'burn ✓' : p.burned === 0n ? 'NO BURN' : `burn ${usdc(p.burned)}`}`);
    console.log(`      score ${p.score === null ? '—' : p.score.toFixed(2)} ${p.verdict} · ${attest} · ${p.executed ? 'paid out' : `blocked: ${p.blockedBy}`}`);
    for (const r of p.reasons) console.log(`      ↳ ${r}`);
    if (p.txs.burn) console.log(`      burn     ${txLink(p.txs.burn)}`);
    console.log(`      request  ${txLink(p.txs.request)}`);
    if (p.txs.attest) console.log(`      attest   ${txLink(p.txs.attest)}`);
    console.log(`      review   ${txLink(p.txs.review)}`);
    console.log(`      execute  ${txLink(p.txs.execute)}`);
  }
  console.log(`    guardian tier: ${ResponseTier[step.tierAfter]}`);
}

console.log('Starting from a clean route:');
const steps = await runTestnetDemo(cfg, c, d, { contractFacts: facts, onStep: print, log: (s) => console.log(s) });
console.log(`\nTiers: NONE → ${steps.slice(1).map((s) => ResponseTier[s.tierAfter]).join(' → ')}\n`);
