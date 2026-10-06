import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeAbiParameters, keccak256, stringToHex, toHex, zeroAddress, type Hex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { cctpBindings } from '../testnet/cctpBindings.js';
import { createCctpAudit, type CctpAuditReader } from '../testnet/cctpAudit.js';
import { cctpDeploymentPlan } from '../testnet/cctpDeployPlan.js';
import { pilotManifestSchema } from '../testnet/cctpManifest.js';
import paymentArtifact from '../testnet/cctpPaymentEscrow.artifact.js';
import { expectedGuardianRuntime, expectedPaymentRuntime } from '../testnet/artifactAcceptance.js';
import { parseCctpBaseline, parseCctpOperatorArgs } from '../testnet/runCctpOperator.js';
import { paymentBindings, paymentFixture } from './fixtures/cctpPayment.js';
import { sender, vault } from './fixtures/cctp.js';
import { readOperationsText } from '../../../src/chains/evm/operations.js';
import { stringifyPublic } from '../testnet/cctpPreflight.js';
import { discoveryFixture } from './fixtures/cctpDiscovery.js';
import { discoverCctpRequests } from '../testnet/cctpDiscovery.js';

const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })); });
const config = { version: 3, deployer: actors.owner.address, owner: actors.bridge.address, oracle: actors.oracle.address,
  deployerNonce: '12', capBaseUnits: '100000000', windowSeconds: '3600',
  payment: { ...paymentBindings, recoveryDelay: '3600', policy: { maxPayment: '10000000', manualApprovalAbove: '5000000', delayAbove: '5000000', delaySeconds: '1800' },
    recipients: [actors.relayer.address] } };
function setup() {
  const f = paymentFixture(), manifest = pilotManifestSchema.parse({ version: 3, vault, guardian: sender,
    operator: actors.oracle.address, payment: paymentBindings, requests: [{ messageId: f.release.messageId, proof: f.locator }] });
  const facts: Record<string, unknown> = { ...cctpBindings(vault), REVIEW_FORMAT_VERSION: 3n, PAYMENT_ESCROW_VERSION: 1n,
    policyAuthority: sender, authorizedSourceSender: sender, recoveryRecipient: sender, recoveryDelay: 3600n,
    token: route.destination.usdc, guardian: sender, routeId: keccak256(stringToHex(route.id)), MAX_REVIEW_TTL: 600n, RELEASE_POLICY_VERSION: 2n,
    releases: [f.release.recipient, f.release.amount, 0, 0n, zeroAddress, 0n, 0],
    credits: [sender, f.intent.operationId, f.intent.policyHash, 0n, false], policyVersion: 1n, policyHash: f.intent.policyHash,
    paymentPolicy: [10_000_000n, 5_000_000n, 5_000_000n, 1800n], approvedPolicyVersion: 0n, reviewedPolicyVersion: 0n,
    paymentsPaused: false, permittedRecipients: true, paymentDelayUntil: 0n, releaseDelayUntil: 0n };
  const reader: CctpAuditReader = { ...f.destination.port, readVault: vi.fn(async (name) => facts[name]),
    readCode: vi.fn(async (address) => address === sender ? expectedGuardianRuntime(sender) : expectedPaymentRuntime(vault, sender, paymentBindings)),
    readGuardian: vi.fn(async (name: Parameters<CctpAuditReader['readGuardian']>[0]) => ({ owner: vault, oracle: actors.oracle.address.toLowerCase(), GUARDIAN_POLICY_VERSION: 2n,
      isProtected: true, currentTier: 0, getRoute: { windowSeconds: 3600n, cap: 10_000_000n, tierExpiresAt: 0n } })[name]) };
  const dir = mkdtempSync(join(tmpdir(), 'tripwire-payment-pilot-')); dirs.push(dir);
  return { f, facts, reader, manifest, stateFile: join(dir, 'observer.sqlite') };
}
describe('customer payment manifest, planning and read-only pilot', () => {
  it('resumes saved hints after restart but withholds cached backing when current receipts fail', async () => {
    const s = setup(), d = discoveryFixture(), seed = { ...s.manifest, requests: [] };
    s.f.source.port.getBlock = d.source.client.pub.getBlock; s.reader.getBlock = d.destination.client.pub.getBlock;
    const first = await createCctpAudit(seed, s.stateFile, s.f.source.port, s.reader, true);
    try {
      const found = await discoverCctpRequests(seed, d.clients, d.starts, new AbortController().signal, { resume: first.store.loadDiscovery() });
      expect((await first.tick(found.manifest)).results[0].evidence.status).toBe('verified'); await found.assertCanonical();
      if (!found.state) throw new Error('Missing discovery state.'); first.store.saveDiscovery(found.state);
    } finally { first.close(); }
    const resumed = await createCctpAudit(seed, s.stateFile, s.f.source.port, s.reader, true);
    try {
      s.f.source.port.getTransactionReceipt = async () => { throw new Error('Receipt RPC unavailable'); };
      const found = await discoverCctpRequests(seed, d.clients, d.starts, new AbortController().signal, { resume: resumed.store.loadDiscovery() });
      const report = await resumed.tick(found.manifest); await found.assertCanonical();
      if (!found.state) throw new Error('Missing state.'); resumed.store.saveDiscovery(found.state);
      const view = readOperationsText(stringifyPublic({ ...report, discovery: found.metadata, status: 'ok', observedAt: '2026-10-06T09:00:00.000Z' }));
      expect(view.discovery?.incremental?.resumed).toBe(true); expect(view.payments[0].evidence).toBe('unavailable');
      expect(view.payments[0].transactions).toEqual([]); expect(resumed.store.sourceProofs()).toHaveLength(1);
      expect(resumed.store.transactions()).toEqual([]);
    } finally { resumed.close(); }
  });
  it('discovers a locator then authenticates full receipts before exporting any verified backing', async () => {
    const s = setup(), d = discoveryFixture(), seed = { ...s.manifest, requests: [] };
    s.f.source.port.getBlock = d.source.client.pub.getBlock;
    s.reader.getBlock = d.destination.client.pub.getBlock;
    const audit = await createCctpAudit(seed, s.stateFile, s.f.source.port, s.reader, true);
    try {
      const found = await discoverCctpRequests(seed, d.clients, d.starts, new AbortController().signal);
      const report = await audit.tick(found.manifest); await found.assertCanonical();
      const view = readOperationsText(stringifyPublic({ ...report, discovery: found.metadata, status: 'ok', observedAt: '2026-10-06T09:00:00.000Z' }));
      expect(view.discovery).toMatchObject({ paired: 1, sourceHints: 1, destinationHints: 1 });
      expect(view.payments[0].evidence).toBe('verified'); expect(view.payments[0].state).toBe('Held');
      expect(audit.store.transactions()).toEqual([]);
      s.f.replaceBound({ intentPolicyHash: toHex(999, { size: 32 }) });
      expect((await audit.tick(found.manifest)).results[0].evidence.status).toBe('invalid'); // Matching hints cannot bypass receipts.
    } finally { audit.close(); }
  });
  it('refuses absent or substituted runtime despite valid getters, before opening a journal', async () => {
    for (const code of ['0x', '0x6000']) {
      const s = setup(); s.reader.readCode = async () => code;
      await expect(createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true)).rejects.toThrow('bytecode');
      expect(existsSync(s.stateFile)).toBe(false);
    }
    const s = setup(); delete s.reader.readCode;
    await expect(createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true)).rejects.toThrow('runtime');
  });
  it('rechecks code at the finalized audit block on every poll', async () => {
    const s = setup(), read = vi.fn(async () => '0x' as Hex);
    const audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    try {
      s.reader.readCode = (address, block) => { expect(block).toBe(200n); return read(); };
      await expect(audit.tick()).rejects.toThrow('bytecode'); expect(read).toHaveBeenCalled();
      expect(audit.store.transactions()).toEqual([]);
    } finally { audit.close(); }
  });
  it('encodes the actual payment artifact and full customer constructor, produces manifest v3', () => {
    const plan = cctpDeploymentPlan(config); const initcode = plan.transactions[1].data;
    expect(plan.artifactHashes.escrow).toBe(keccak256(paymentArtifact.bytecode));
    expect(initcode.startsWith(paymentArtifact.bytecode)).toBe(true);
    const constructor = paymentArtifact.abi.find((entry) => entry.type === 'constructor');
    if (!constructor || constructor.type !== 'constructor') throw new Error('Constructor missing.');
    const decoded = decodeAbiParameters(constructor.inputs, `0x${initcode.slice(paymentArtifact.bytecode.length)}` as Hex);
    expect(decoded[4]).toMatchObject({ authority: actors.owner.address, returnRecipient: actors.owner.address, sourceSender: actors.owner.address,
      recoveryDelay: 3600n, policy: { maxPayment: 10_000_000n, delaySeconds: 1800n }, recipients: [actors.relayer.address] });
    expect(pilotManifestSchema.parse(plan.manifest)).toMatchObject({ version: 3, payment: paymentBindings, requests: [] });
  });
  it.each([
    { authority: config.oracle }, { recoveryDelay: '3599' }, { recoveryDelay: '2592001' }, { sourceSender: zeroAddress },
    { returnRecipient: zeroAddress }, { recipients: [config.payment.recipients[0], config.payment.recipients[0]] },
    { policy: { ...config.payment.policy, maxPayment: '0' } }, { policy: { ...config.payment.policy, manualApprovalAbove: '10000001' } },
    { policy: { ...config.payment.policy, delaySeconds: '2592001' } },
  ])('refuses invalid customer deployment input %j', (over) => expect(() => cctpDeploymentPlan({ ...config, payment: { ...config.payment, ...over } })).toThrow());
  it('verifies intent receipts and customer policy without producing transactions or ALLOW', async () => {
    const s = setup(), audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    try {
      const report = await audit.tick(); expect(report.policy).toBe('customer-payment'); expect(report.counts.verified).toBe(1);
      expect(report.results[0]).toMatchObject({ recommendation: 'HOLD', payment: { blockers: [], returned: false, version: 1n } });
      expect(audit.store.sourceProofs()[0].payment).toEqual(s.f.intent); expect(audit.store.transactions()).toEqual([]);
      const display = readOperationsText(stringifyPublic({ ...report, status: 'ok', observedAt: '2026-10-06T07:00:00.000Z' }));
      expect(display.payments[0].operationId).toBe(s.f.intent.operationId);
      expect(display.payments[0].returnRecipient).toBe(s.f.intent.returnRecipient);
      expect(display.payments[0].state).toBe('Held'); expect(display.payments[0].transactions).toHaveLength(2);
      expect(display.payments[0].lifecycle).toMatchObject({ status: 'reported', closed: false, settlementSeconds: 0n, escrowSeconds: 0n });
      expect(display.payments[0].lifecycle?.milestones.map((m) => m.label)).toEqual(['Source burn', 'Escrow funded']);
    } finally { audit.close(); }
  });
  it('reports RETURNED separately from a rejected funded credit', async () => {
    const s = setup(); s.facts.releases = [s.f.release.recipient, s.f.release.amount, 3, 0n, zeroAddress, 1n, 0];
    const audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    try {
      const rejected = (await audit.tick()).results[0]; expect(rejected.release?.state).toBe('REJECTED'); expect(rejected.reason).toContain('still request');
      s.facts.credits = [sender, s.f.intent.operationId, s.f.intent.policyHash, 100n, true];
      const returned = (await audit.tick()).results[0]; expect(returned.release?.state).toBe('RETURNED'); expect(returned.payment?.returned).toBe(true);
      expect(returned.lifecycle?.status).toBe('unavailable'); // State getter has no completion receipt history.
    } finally { audit.close(); }
  });
  it('round-trips an actual decoded payout receipt, then suppresses it on current RPC failure', async () => {
    const s = setup(), tx = toHex(900, { size: 32 }), hash = toHex(300, { size: 32 });
    s.facts.releases = [s.f.release.recipient, s.f.release.amount, 4, 0n, zeroAddress, 1n, 0];
    const originalBlock = s.reader.getBlock;
    s.reader.getBlock = async (args) => 'blockNumber' in args && args.blockNumber === 200n ? originalBlock(args)
      : { number: 300n, hash, parentHash: toHex(299, { size: 32 }), timestamp: 1_780_000_500n };
    const log = { ...s.f.log(paymentArtifact.abi, 'ReleaseExecuted', { messageId: s.f.release.messageId, to: s.f.release.recipient, amount: s.f.release.amount }, 10, vault, false),
      blockNumber: 300n, blockHash: hash, transactionHash: tx };
    const receipt = { transactionHash: tx, blockNumber: 300n, blockHash: hash, status: 'success', logs: [log] };
    s.reader.readPaymentEvents = async () => [log];
    s.reader.getTransactionReceipt = async ({ hash: requested }) => requested === tx ? receipt : s.f.destinationReceipt;
    const audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    try {
      const report = await audit.tick();
      const view = readOperationsText(stringifyPublic({ ...report, status: 'ok', observedAt: '2026-10-06T07:00:00.000Z' }));
      expect(view.payments[0].state).toBe('Paid'); expect(view.payments[0].lifecycle).toMatchObject({ closed: true, escrowSeconds: 500n });
      expect(view.payments[0].lifecycle?.milestones.at(-1)?.hash).toBe(tx);
      s.reader.getTransactionReceipt = async ({ hash: requested }) => requested === tx ? null : s.f.destinationReceipt;
      expect((await audit.tick()).results[0].lifecycle?.status).toBe('unavailable');
      expect(audit.store.transactions()).toEqual([]);
    } finally { audit.close(); }
  });
  it('does not export an old cached proof when current receipt evidence is unavailable', async () => {
    const s = setup(), audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    try {
      expect((await audit.tick()).results[0].proof).toBeDefined();
      s.f.source.port.getTransactionReceipt = async () => { throw new Error('Receipt RPC unavailable'); };
      const report = await audit.tick(); expect(report.results[0].evidence.status).toBe('unavailable'); expect(report.results[0].proof).toBeUndefined();
      const view = readOperationsText(stringifyPublic({ ...report, status: 'ok', observedAt: '2026-10-06T07:00:00.000Z' }));
      expect(view.payments[0].state).toBe('Unavailable'); expect(view.payments[0].transactions).toEqual([]);
      expect(audit.store.transactions()).toEqual([]);
    } finally { audit.close(); }
  });
  it('refuses customer binding changes in a reloaded manifest', async () => {
    const s = setup(), audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    try { await expect(audit.tick({ ...s.manifest, payment: { ...paymentBindings, recoveryDelay: 7200n } })).rejects.toThrow('scope'); }
    finally { audit.close(); }
  });
  it.each(['REVIEW_FORMAT_VERSION', 'PAYMENT_ESCROW_VERSION', 'authorizedSourceSender', 'recoveryDelay'])('refuses a mismatched %s before opening the journal', async (name) => {
    const s = setup(); s.facts[name] = name === 'authorizedSourceSender' ? vault : 99n;
    await expect(createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true)).rejects.toThrow();
    expect(existsSync(s.stateFile)).toBe(false);
  });
  it('requires explicit scan boundaries and validates baseline input rather than fabricating it', () => {
    expect(parseCctpOperatorArgs(['manifest.json', 'state.sqlite', '100', '200', '--watch'])).toMatchObject({ sourceStartBlock: 100n, destinationStartBlock: 200n, watch: true });
    expect(() => parseCctpOperatorArgs(['manifest.json', 'state.sqlite', '-1', '200'])).toThrow();
    expect(() => parseCctpOperatorArgs(['manifest.json', 'state.sqlite', '100'])).toThrow();
    expect(() => parseCctpBaseline({ route: 'unrelated' })).toThrow();
  });
});
