// Mutation tests for the guardian's tier logic, the vault's release review gate,
// the k-of-n attestor quorum, and the audit remediation (policy v4: time-locked
// oracle rotation, bounded oracle protection, cumulative DELAY, REJECT cooldown).
//
//   npm run test:mutants
//
// Each mutant breaks one property the guardian promises (see the @dev block in
// TripwireGuardian.sol). For each: patch the source, recompile the committed
// artifact the tests deploy, run the contract tests, and require a failure.
// The source and artifact are always restored, even if a run crashes or is
// interrupted (SIGINT/SIGTERM): a killed run must never leave a mutant applied.
// Exits non-zero if any mutant survives or no longer applies.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const SOL = 'contracts/evm/src/TripwireGuardian.sol', ART = 'src/tripwire/guardian.artifact.ts';
const sol = readFileSync(SOL, 'utf8'), art = readFileSync(ART, 'utf8');
const VAULT = 'contracts/evm/src/TripwireDemo.sol', DEMO_ART = 'scripts/tripwire/testnet/contracts.artifact.ts';
const vault = readFileSync(VAULT, 'utf8'), demoArt = readFileSync(DEMO_ART, 'utf8');
const ESCROW = 'contracts/evm/src/CctpEscrow.sol', CCTP_ART = 'scripts/tripwire/testnet/cctpEscrow.artifact.ts';
const escrow = readFileSync(ESCROW, 'utf8'), cctpArt = readFileSync(CCTP_ART, 'utf8');
const M = [
 ['DELAY cap: DELAY gets the full cap', 'tier == Tier.THROTTLE || tier == Tier.DELAY ? uint256(cap) / 2', 'tier == Tier.THROTTLE ? uint256(cap) / 2'],
 ['DELAY hold: never holds', 'if (held > r.cap / 10) revert OutflowDelayed', 'if (false) revert OutflowDelayed'],
 ['DELAY hold: threshold > becomes >=', 'held > r.cap / 10', 'held >= r.cap / 10'],
 ['DELAY hold: window ignored', 'tier == Tier.DELAY && block.timestamp < r.delayUntil) {', 'tier == Tier.DELAY) {'],
 ['DELAY hold: split payouts not counted', 'r.delayedOutflow = uint128(held);', ''],
 ['DELAY hold: budget carries into a new DELAY', 'r.delayUntil = uint64(block.timestamp) + DELAY_WINDOW;\n                r.delayedOutflow = 0;', 'r.delayUntil = uint64(block.timestamp) + DELAY_WINDOW;'],
 ['escalate-only: downgrades allowed', 'if (incoming >= active) {', 'if (true) {'],
 ['refresh reopens the DELAY window', 'incoming == Tier.DELAY && active != Tier.DELAY', 'incoming == Tier.DELAY'],
 ['reconfigure clears the tier', 'emit RouteConfigured(routeId, cap, windowSeconds);', 'r.tier = Tier.NONE; r.tierExpiresAt = 0; r.pausedUntil = 0;\n        emit RouteConfigured(routeId, cap, windowSeconds);'],
 ['resume keeps the pause', 'r.pausedUntil = 0;\n        r.tier = Tier.NONE;', 'r.tier = Tier.NONE;'],
 ['resume keeps the tier', 'r.tier = Tier.NONE;\n        r.tierExpiresAt = 0;\n        r.delayUntil = 0;', 'r.delayUntil = 0;'],
 ['resume keeps the DELAY hold clock', 'r.tierExpiresAt = 0;\n        r.delayUntil = 0;', 'r.tierExpiresAt = 0;'],
 ['THROTTLE threshold off by one', 'riskScore < THROTTLE_THRESHOLD', 'riskScore <= THROTTLE_THRESHOLD'],
 ['DELAY threshold off by one', 'riskScore >= DELAY_THRESHOLD', 'riskScore > DELAY_THRESHOLD'],
 ['FREEZE threshold off by one', 'riskScore >= FREEZE_THRESHOLD', 'riskScore > FREEZE_THRESHOLD'],
 ['FREEZE does not pause', 'if (incoming == Tier.FREEZE) r.pausedUntil = until;', ''],
 ['route isolation: any reporter spends any route', 'if (!isProtected[msg.sender][routeId]) revert NotProtected(msg.sender);', ''],
 ['rolling limit: previous usage ignored', 'uint256 total = rollingUsage(routeId) + amount;', 'uint256 total = amount;'],
 ['rolling limit: last ring slot omitted', 'i < ROLLING_BUCKETS; ++i', 'i < ROLLING_BUCKETS - 1; ++i'],
 ['rolling limit: expires usage one second early', 'uint256(bucket.lastOutflow) + window > block.timestamp', 'uint256(bucket.lastOutflow) + window - 1 > block.timestamp'],
 ['rolling limit: reconfigure discards spent budget', 'emit RouteConfigured(routeId, cap, windowSeconds);', 'delete _outflows[routeId];\n        emit RouteConfigured(routeId, cap, windowSeconds);'],
 // Audit remediation, policy v4.
 ['rotation: notice period skipped', 'if (block.timestamp < pendingOracleAt) revert RotationNotReady(pendingOracleAt);', ''],
 ['rotation: anyone proposes an oracle', 'function proposeOracle(address next) external onlyOwner', 'function proposeOracle(address next) external'],
 ['kill switch: disable leaves the oracle in place', 'oracle = address(0);', ''],
 ['kill switch: a pending rotation survives it', 'emit OracleRotationCancelled(pendingOracle);\n            pendingOracle = address(0);', 'emit OracleRotationCancelled(pendingOracle);'],
 ['protection: cap raised during a tier', 'if (r.windowSeconds != 0 && cap > r.cap && currentTier(routeId) != Tier.NONE) revert RaiseDuringProtection(routeId);', ''],
 ['span: refreshes extend past 72 hours', 'if (until > limit) until = limit;', ''],
 ['span: no cooldown between spans', '+ MAX_ORACLE_PROTECTION + PROTECTION_COOLDOWN', '+ MAX_ORACLE_PROTECTION'],
 ['span: an exhausted span still accepts', 'if (until <= block.timestamp) revert ProtectionSpanExhausted(routeId);', ''],
 ['span: owner re-arm ignored', 'r.protectionSince = uint64(block.timestamp);\n        emit ProtectionRearmed', 'emit ProtectionRearmed'],
 ['span: resume keeps a spent span', 'r.protectionSince = 0;', ''],
];
const REVIEW_MUTANTS = [
 ['review signer: any signature accepted', 'if (reviewer != current) revert InvalidReviewer(reviewer);', ''],
 ['review nonce: older approvals accepted', 'if (nonce <= r.reviewNonce)', 'if (nonce == r.reviewNonce)'],
 ['review decision: HOLD and REJECT become VERIFIED', 'r.state = decision == ReviewDecision.ALLOW\n            ? ReleaseState.VERIFIED : decision == ReviewDecision.HOLD ? ReleaseState.HELD : ReleaseState.REJECTED;', 'r.state = ReleaseState.VERIFIED;'],
 ['review expiry: old allowance to execute stays valid', 'if (block.timestamp > r.reviewedUntil) revert ReviewExpired(r.reviewedUntil);', ''],
 ['review rotation: old signer allowance stays valid', 'if (r.reviewer != ITripwireOracle(address(guardian)).oracle()) revert InvalidReviewer(r.reviewer);', ''],
 ['review protection: no risk tier required', 'if (guardian.currentTier(routeId) < r.minimumTier) revert RequiredProtectionMissing(routeId, r.minimumTier);', ''],
 ['review execution: a release can pay twice', 'r.state = ReleaseState.EXECUTED;', ''],
 ['request delay: ALLOW never starts the clock', 'if (delay > 0) releaseDelayUntil[messageId]', 'if (false) releaseDelayUntil[messageId]'],
 ['request delay: repeated reviews reopen the clock', 'decision == ReviewDecision.ALLOW && releaseDelayUntil[messageId] == 0', 'decision == ReviewDecision.ALLOW'],
 ['request delay: a waiting payout can execute', 'if (block.timestamp < releaseAt) revert ReleaseDelayed(messageId, releaseAt);', ''],
 ['request delay: a clear review bypasses starting a DELAY clock', 'if (releaseAt == 0 && guardian.outflowDelay(routeId, r.amount) > 0) revert RequestDelayNotStarted(messageId);', ''],
 // Audit remediation (CRIT-2): REJECT is a 7-day hard hold, then re-reviewable.
 ['rejection: REJECT is terminal again', 'r.state == ReleaseState.REJECTED && block.timestamp < rejectedAt[messageId] + REJECTION_COOLDOWN', 'r.state == ReleaseState.REJECTED'],
 ['rejection: no hold at all', 'r.state == ReleaseState.REJECTED && block.timestamp < rejectedAt[messageId] + REJECTION_COOLDOWN', 'false'],
 ['rejection: REJECT does not start the hold', 'if (decision == ReviewDecision.REJECT) rejectedAt[messageId] = block.timestamp;', ''],
];
const CCTP_MUTANTS = [
 ['CCTP ownership: owner may invent credits', 'ProtectedVault(address(this), token_, guardian_, routeId_)', 'ProtectedVault(msg.sender, token_, guardian_, routeId_)'],
 ['CCTP source: wrong messenger accepted', '_address(message, 44) != sourceMessenger ||', ''],
 ['CCTP caller: unrestricted receives accepted', '_address(message, 108) != address(this) ||', ''],
 ['CCTP finality: fast receive accepted', 'uint32(bytes4(message[144:148])) != 2000 ||', ''],
 ['CCTP hook: unknown beneficiary format accepted', 'bytes32(message[376:408]) != BENEFICIARY_HOOK', 'false'],
 ['CCTP fee: max fee ignored', 'fee > maxFee ||', ''],
 ['CCTP receive: false success accepted', 'if (!transmitter.receiveMessage(message, attestation)) revert CctpReceiveFailed();', 'transmitter.receiveMessage(message, attestation);'],
 ['CCTP mint: pooled funds count as a fresh deposit', 'if (afterMint < beforeMint || afterMint - beforeMint != net) revert CctpMintMismatch();', ''],
];
// Threshold attestation (ADR-021): the quorum contract, and the guardian's and
// vault's ERC-1271 path that consults it. Each file is restored after its mutant.
const QUORUM = 'contracts/evm/src/TripwireQuorum.sol';
const quorum = readFileSync(QUORUM, 'utf8');
const ORACLE_MUTANTS = [
 [QUORUM, 'quorum: fewer than threshold accepted', 'count < threshold || ', ''],
 [QUORUM, 'quorum: a repeated key counts twice', 'signer <= previous ||', 'signer < previous ||'],
 [QUORUM, 'quorum: an outsider counts', ' || !isSigner[signer]', ''],
 [QUORUM, 'quorum: majority rule dropped', ' || nextThreshold * 2 <= n', ''],
 [QUORUM, 'quorum: anyone rotates membership', 'if (!_quorumSigned(hashUpdate(next, nextThreshold, epoch), signature)) revert QuorumNotMet();', ''],
 [QUORUM, 'quorum: rotation approval replayable', '++epoch;', ''],
 [QUORUM, 'quorum: removed signers keep counting', 'for (uint256 i; i < _signers.length; ++i) isSigner[_signers[i]] = false;', ''],
 [SOL, 'guardian: single-key signature unchecked', 'if (signer != current) revert InvalidSigner(signer);', ''],
 [SOL, 'guardian: contract oracle unchecked', 'revert InvalidSigner(current);', ''],
 [VAULT, 'vault: contract oracle unchecked', 'revert InvalidReviewer(current);', ''],
];
const ORIGINAL = { [QUORUM]: quorum, [SOL]: sol, [VAULT]: vault };
const restore = () => {
  writeFileSync(SOL, sol); writeFileSync(ART, art);
  writeFileSync(VAULT, vault); writeFileSync(DEMO_ART, demoArt);
  writeFileSync(ESCROW, escrow); writeFileSync(CCTP_ART, cctpArt);
  writeFileSync(QUORUM, quorum);
};
// `finally` does not run when the process is killed. Restore on the way out.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => { restore(); process.exit(130); });
const results = [];
try {
  for (const [name, from, to] of M) {
    if (!sol.includes(from)) { results.push([name, 'PATTERN NOT FOUND']); continue; }
    writeFileSync(SOL, sol.replace(from, to));
    execSync('node contracts/evm/compile.mjs', { stdio: 'ignore' });
    let caught;
    try { execSync('npx vitest run contracts/evm/test/TripwireGuardian.evm.test.ts contracts/evm/test/routeLimits.evm.test.ts contracts/evm/test/auditRegression.evm.test.ts -t "^(?!artifact)"', { stdio: 'ignore' }); caught = false; } catch { caught = true; }
    results.push([name, caught ? 'caught' : 'SURVIVED']);
    console.log(results.at(-1)[1].padEnd(18), name);
  }
  writeFileSync(SOL, sol);
  for (const [name, from, to] of REVIEW_MUTANTS) {
    if (!vault.includes(from)) { results.push([name, 'PATTERN NOT FOUND']); continue; }
    writeFileSync(VAULT, vault.replace(from, to));
    execSync('node contracts/evm/compile.mjs', { stdio: 'ignore' });
    let caught;
    try { execSync('npx vitest run contracts/evm/test/releaseSafety.evm.test.ts contracts/evm/test/routeLimits.evm.test.ts contracts/evm/test/auditRegression.evm.test.ts', { stdio: 'ignore' }); caught = false; } catch { caught = true; }
    results.push([name, caught ? 'caught' : 'SURVIVED']);
    console.log(results.at(-1)[1].padEnd(18), name);
  }
  writeFileSync(VAULT, vault);
  for (const [file, name, from, to] of ORACLE_MUTANTS) {
    const source = ORIGINAL[file];
    if (!source.includes(from)) { results.push([name, 'PATTERN NOT FOUND']); continue; }
    writeFileSync(file, source.replace(from, to));
    execSync('node contracts/evm/compile.mjs', { stdio: 'ignore' });
    let caught;
    try { execSync('npx vitest run contracts/evm/test/quorum.evm.test.ts contracts/evm/test/TripwireGuardian.evm.test.ts contracts/evm/test/releaseSafety.evm.test.ts -t "^(?!artifact)"', { stdio: 'ignore' }); caught = false; } catch { caught = true; }
    writeFileSync(file, source);
    results.push([name, caught ? 'caught' : 'SURVIVED']);
    console.log(results.at(-1)[1].padEnd(18), name);
  }
  for (const [name, from, to] of CCTP_MUTANTS) {
    if (!escrow.includes(from)) { results.push([name, 'PATTERN NOT FOUND']); continue; }
    writeFileSync(ESCROW, escrow.replace(from, to));
    execSync('node contracts/evm/compile.mjs', { stdio: 'ignore' });
    let caught;
    try { execSync('npx vitest run contracts/evm/test/cctpEscrow.evm.test.ts', { stdio: 'ignore' }); caught = false; } catch { caught = true; }
    results.push([name, caught ? 'caught' : 'SURVIVED']);
    console.log(results.at(-1)[1].padEnd(18), name);
  }
} finally {
  restore();
}
for (const [name, status] of results.filter((r) => r[1] === 'PATTERN NOT FOUND')) console.log(status.padEnd(18), name);
const bad = results.filter((r) => r[1] !== 'caught').length;
console.log(bad ? `${bad} of ${results.length} mutants not caught` : `all ${results.length} mutants caught`);
process.exit(bad ? 1 : 0);
