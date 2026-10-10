// Keyless audit/observer for the screened escrow (H4c3c): synthetic finalized RPC
// facts and real v2-hook CCTP proofs; the report must round-trip through the
// public operations schema. No key, signature, transaction or provider here.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keccak256, stringToHex, toHex, zeroAddress, type Hex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { screeningPaymentContextHash, screeningProfileHash, type ScreeningProfile } from '../../../src/chains/evm/screening.js';
import { readOperationsText } from '../../../src/chains/evm/operations.js';
import { cctpBindings } from '../testnet/cctpBindings.js';
import { createCctpAudit, type CctpAuditReader } from '../testnet/cctpAudit.js';
import { parseAuditManifest, parseObserverManifest } from '../testnet/cctpManifest.js';
import { expectedGuardianRuntime, expectedPaymentRuntime } from '../testnet/artifactAcceptance.js';
import { stringifyPublic } from '../testnet/cctpPreflight.js';
import { LOCAL_PROFILE, SCREENING_ISSUER } from '../screenedLocal.js';
import { paymentBindings, paymentFixture } from './fixtures/cctpPayment.js';
import { sender, vault } from './fixtures/cctp.js';

const ZERO = `0x${'0'.repeat(64)}` as Hex;
const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })); });
const profileInput = { version: 1, providerIdHash: LOCAL_PROFILE.providerIdHash, listIdHash: LOCAL_PROFILE.listIdHash, issuer: SCREENING_ISSUER.address,
  subject: 'payout-recipient', maxObservationAgeSeconds: '300', maxSnapshotAgeSeconds: '3600' };

function setup() {
  const f = paymentFixture(2), routeId = keccak256(stringToHex(route.id));
  const manifest = { version: 4, vault, guardian: sender, operator: actors.oracle.address, payment: { ...paymentBindings, recoveryDelay: '3600' },
    screening: profileInput, requests: [{ messageId: f.release.messageId, proof: f.locator }] };
  const scope = { destinationChainId: BigInt(route.destination.chainId), vault, guardian: sender, routeId, token: route.destination.usdc.toLowerCase() as Hex };
  const profile: ScreeningProfile = { version: 1, providerIdHash: LOCAL_PROFILE.providerIdHash, listIdHash: LOCAL_PROFILE.listIdHash,
    issuer: SCREENING_ISSUER.address.toLowerCase() as Hex, subject: 'payout-recipient', maxObservationAgeSeconds: 300n, maxSnapshotAgeSeconds: 3600n };
  const facts: Record<string, unknown> = { ...cctpBindings(vault), REVIEW_FORMAT_VERSION: 4n, PAYMENT_ESCROW_VERSION: 1n, SCREENING_ESCROW_VERSION: 2n,
    policyAuthority: sender, authorizedSourceSender: sender, recoveryRecipient: sender, recoveryDelay: 3600n,
    token: route.destination.usdc, guardian: sender, routeId, MAX_REVIEW_TTL: 600n, RELEASE_POLICY_VERSION: 4n,
    releases: [f.release.recipient, f.release.amount, 0, 0n, zeroAddress, 0n, 0],
    credits: [sender, f.intent.operationId, f.intent.policyHash, 0n, false], policyVersion: 1n, policyHash: f.intent.policyHash,
    paymentPolicy: [10_000_000n, 5_000_000n, 5_000_000n, 1800n], approvedPolicyVersion: 0n, reviewedPolicyVersion: 0n,
    paymentsPaused: false, permittedRecipients: true, paymentDelayUntil: 0n, releaseDelayUntil: 0n,
    executionMode: 0, screeningProfileHash: screeningProfileHash(scope, profile), activeHead: [ZERO, 0n, 0n, 0n], screened: [ZERO, ZERO, 0n] };
  const context = () => {
    const r = facts.releases as [Hex, bigint], c = facts.credits as [Hex, Hex, Hex];
    return { ...scope, sourceSender: sender, policyVersion: facts.policyVersion as bigint, policyHash: facts.policyHash as Hex, messageId: f.release.messageId,
      operationId: c[1], recipient: r[0], amount: r[1], returnRecipient: c[0], intentPolicyHash: c[2] };
  };
  const guardian: Record<string, unknown> = { owner: vault, oracle: actors.oracle.address.toLowerCase(), GUARDIAN_POLICY_VERSION: 4n,
    isProtected: true, currentTier: 0, getRoute: { windowSeconds: 3600n, cap: 10_000_000n, tierExpiresAt: 0n } };
  const reader: CctpAuditReader = { ...f.destination.port,
    readVault: vi.fn(async (name) => name === 'paymentContextHash' ? screeningPaymentContextHash(context()) : facts[name]),
    readCode: vi.fn(async (address) => address === sender ? expectedGuardianRuntime(sender)
      : expectedPaymentRuntime(vault, sender, paymentBindings, undefined, undefined, 'screened')),
    readGuardian: vi.fn(async (name: Parameters<CctpAuditReader['readGuardian']>[0]) => guardian[name]) };
  const dir = mkdtempSync(join(tmpdir(), 'tripwire-screened-audit-')); dirs.push(dir);
  const view = (report: object) => readOperationsText(stringifyPublic({ ...report, status: 'ok', observedAt: '2026-10-10T09:00:00.000Z' }));
  return { f, facts, guardian, reader, manifest, stateFile: join(dir, 'observer.sqlite'), view };
}

describe('keyless screened audit and observer (manifest 4)', () => {
  it('authenticates the v2-hook credit and reports on-chain screening state that the public page accepts', async () => {
    const s = setup();
    const audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    try {
      const report = await audit.tick();
      expect(report.policy).toBe('screened-payment'); expect(report.scope.manifestVersion).toBe(4);
      expect(report.results[0].evidence.status).toBe('verified');
      expect(report.results[0].screening).toEqual({ version: 1, mode: 'legacy', profile: 'accepted', issuerIndependent: true, head: null,
        allowEvidence: null, authorization: 'none' });
      expect(report.blockers.some((b) => b.includes('authorizes nothing'))).toBe(true);
      expect(audit.store.scope.sourceVerifier?.profile).toBe('customer-payment-screened-v1');
      const page = s.view(report);
      expect(page.contracts[1].label).toBe('Screened payment escrow');
      expect(page.payments[0].reasons).toEqual(expect.arrayContaining(['No active screening list head.',
        'Screening state is shown from the chain; this file does not authorize release.']));
      expect(audit.store.transactions()).toEqual([]);
    } finally { audit.close(); }
  });

  it('shows advisory consent, a current head and a current receipt, and only then calls the receipt current', async () => {
    const s = setup();
    const now = (await s.f.destination.port.getBlock({ blockTag: 'finalized' }) as { timestamp: bigint }).timestamp;
    s.facts.executionMode = 1; s.facts.activeHead = [toHex(5, { size: 32 }), 2n, now - 10n, now + 3000n];
    s.facts.screened = [toHex(6, { size: 32 }), toHex(5, { size: 32 }), now + 100n];
    const audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    try {
      const report = await audit.tick();
      expect(report.results[0].screening).toMatchObject({ mode: 'advisory', head: { revision: 2n, current: true }, allowEvidence: { validUntil: now + 100n, current: true } });
      expect(s.view(report).payments[0].reasons).toEqual(expect.arrayContaining([
        'Advisory mode (customer consent on chain): behavioral signals are shown but do not hold this payment.',
        'An issuer screening receipt backs the current review.']));
    } finally { audit.close(); }
  });

  it('holds and explains a revoked profile, but refuses a different active profile', async () => {
    const revoked = setup(); revoked.facts.screeningProfileHash = ZERO;
    const audit = await createCctpAudit(revoked.manifest, revoked.stateFile, revoked.f.source.port, revoked.reader, true);
    try {
      const report = await audit.tick();
      expect(report.results[0].payment?.blockers).toContain('screening');
      expect(report.results[0].screening?.profile).toBe('revoked');
      const page = revoked.view(report);
      expect(page.payments[0].state).toBe('Held');
      expect(page.payments[0].reasons).toContain('Screening profile is revoked, replaced or not independent of the reviewer.');
    } finally { audit.close(); }
    const other = setup(); other.facts.screeningProfileHash = toHex(9, { size: 32 });
    await expect(createCctpAudit(other.manifest, other.stateFile, other.f.source.port, other.reader, true)).rejects.toMatchObject({ reason: 'deployment', message: expect.stringContaining('profile differs') });
  });

  it('refuses the plain payment runtime, review format 3, and a changed profile in a reloaded manifest', async () => {
    const plain = setup();
    plain.reader.readCode = vi.fn(async (address: Hex) => address === sender ? expectedGuardianRuntime(sender) : expectedPaymentRuntime(vault, sender, paymentBindings));
    await expect(createCctpAudit(plain.manifest, plain.stateFile, plain.f.source.port, plain.reader, true)).rejects.toMatchObject({ reason: 'deployment', message: expect.stringContaining('bytecode') });
    const format = setup(); format.facts.REVIEW_FORMAT_VERSION = 3n;
    await expect(createCctpAudit(format.manifest, format.stateFile, format.f.source.port, format.reader, true)).rejects.toMatchObject({ reason: 'deployment' });
    const s = setup();
    const audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    try {
      await expect(audit.tick({ ...s.manifest, screening: { ...profileInput, maxObservationAgeSeconds: '120' } })).rejects.toThrow('scope');
      expect((await audit.tick(parseObserverManifest(s.manifest))).results).toHaveLength(1); // an already parsed manifest round-trips
    } finally { audit.close(); }
  });

  it('selects manifest 4 only by its version, and requires a request for a one-shot audit', () => {
    const s = setup();
    expect(parseAuditManifest(s.manifest, false).version).toBe(4);
    expect(() => parseAuditManifest({ ...s.manifest, requests: [] }, false)).toThrow();
    expect(parseAuditManifest({ ...s.manifest, requests: [] }, true).version).toBe(4);
    const { screening: _profile, ...noProfile } = s.manifest;
    expect(() => parseAuditManifest(noProfile, true)).toThrow();
    expect(() => parseAuditManifest({ ...s.manifest, version: 3 }, true)).toThrow();
  });

  it('the public schema refuses mixed screened and unscreened rows or versions', async () => {
    const s = setup();
    const audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    let report: Awaited<ReturnType<typeof audit.tick>>;
    try { report = await audit.tick(); } finally { audit.close(); }
    const row = report.results[0];
    expect(() => s.view({ ...report, policy: 'customer-payment' })).toThrow();
    expect(() => s.view({ ...report, scope: { ...report.scope, manifestVersion: 3 } })).toThrow();
    expect(() => s.view({ ...report, results: [{ ...row, screening: undefined }] })).toThrow();
    expect(() => s.view({ ...report, results: [{ ...row, screening: { ...row.screening, authorization: 'allow' } }] })).toThrow();
    expect(() => s.view({ ...report, results: [{ ...row, payment: { ...row.payment, blockers: ['screening'] } }] })).toThrow();
    expect(() => s.view({ ...report, results: [{ ...row, screening: { ...row.screening, allowEvidence: { validUntil: 1n, current: true } } }] })).toThrow();
  });
});
