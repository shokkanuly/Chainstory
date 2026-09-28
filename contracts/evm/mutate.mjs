// Mutation test for the guardian's tier logic.
//
//   npm run test:mutants
//
// Each mutant breaks one property the guardian promises (see the @dev block in
// TripwireGuardian.sol). For each: patch the source, recompile the committed
// artifact the tests deploy, run the contract tests, and require a failure.
// The source and artifact are always restored, even if a run crashes.
// Exits non-zero if any mutant survives or no longer applies.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const SOL = 'contracts/evm/src/TripwireGuardian.sol', ART = 'src/tripwire/guardian.artifact.ts';
const sol = readFileSync(SOL, 'utf8'), art = readFileSync(ART, 'utf8');
const M = [
 ['DELAY cap: DELAY gets the full cap', 'tier == Tier.THROTTLE || tier == Tier.DELAY ? uint256(cap) / 2', 'tier == Tier.THROTTLE ? uint256(cap) / 2'],
 ['DELAY hold: never holds', 'tier == Tier.DELAY && block.timestamp < r.delayUntil && amount > r.cap / 10', 'false && tier == Tier.DELAY'],
 ['DELAY hold: threshold > becomes >=', 'amount > r.cap / 10', 'amount >= r.cap / 10'],
 ['DELAY hold: window ignored', 'block.timestamp < r.delayUntil && amount', 'amount'],
 ['escalate-only: downgrades allowed', 'if (incoming >= active) {', 'if (true) {'],
 ['refresh reopens the DELAY window', 'incoming == Tier.DELAY && active != Tier.DELAY', 'incoming == Tier.DELAY'],
 ['reconfigure clears the tier', 'r.outflowInWindow = 0;\n        emit RouteConfigured', 'r.outflowInWindow = 0;\n        r.tier = Tier.NONE; r.tierExpiresAt = 0; r.pausedUntil = 0;\n        emit RouteConfigured'],
 ['resume keeps the pause', 'r.pausedUntil = 0;\n        r.tier = Tier.NONE;', 'r.tier = Tier.NONE;'],
 ['resume keeps the tier', 'r.tier = Tier.NONE;\n        r.tierExpiresAt = 0;\n        r.delayUntil = 0;', 'r.delayUntil = 0;'],
 ['resume keeps the DELAY hold clock', 'r.tierExpiresAt = 0;\n        r.delayUntil = 0;', 'r.tierExpiresAt = 0;'],
 ['THROTTLE threshold off by one', 'riskScore < THROTTLE_THRESHOLD', 'riskScore <= THROTTLE_THRESHOLD'],
 ['DELAY threshold off by one', 'riskScore >= DELAY_THRESHOLD', 'riskScore > DELAY_THRESHOLD'],
 ['FREEZE threshold off by one', 'riskScore >= FREEZE_THRESHOLD', 'riskScore > FREEZE_THRESHOLD'],
 ['FREEZE does not pause', 'if (incoming == Tier.FREEZE) r.pausedUntil = until;', ''],
];
const results = [];
try {
  for (const [name, from, to] of M) {
    if (!sol.includes(from)) { results.push([name, 'PATTERN NOT FOUND']); continue; }
    writeFileSync(SOL, sol.replace(from, to));
    execSync('node contracts/evm/compile.mjs', { stdio: 'ignore' });
    let caught;
    try { execSync('npx vitest run contracts/ -t "^(?!artifact)"', { stdio: 'ignore' }); caught = false; } catch { caught = true; }
    results.push([name, caught ? 'caught' : 'SURVIVED']);
  }
} finally { writeFileSync(SOL, sol); writeFileSync(ART, art); }
for (const r of results) console.log(r[1].padEnd(18), r[0]);
const bad = results.filter((r) => r[1] !== 'caught').length;
console.log(bad ? `${bad} of ${results.length} mutants not caught` : `all ${results.length} mutants caught`);
process.exit(bad ? 1 : 0);
