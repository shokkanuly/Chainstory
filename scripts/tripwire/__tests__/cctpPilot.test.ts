import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { zeroAddress, keccak256, stringToHex } from 'viem';
import { cctpBindings } from '../testnet/cctpBindings.js';
import { createCctpAudit, type CctpAuditReader } from '../testnet/cctpAudit.js';
import { pilotManifestSchema } from '../testnet/cctpManifest.js';
import { authenticatedFixture } from './fixtures/cctpEscrow.js';
import { fixture, sender, vault } from './fixtures/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { parseObserveArgs, saveObservation } from '../testnet/observeCctp.js';
import { existsSync } from 'node:fs';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const f = authenticatedFixture();
  const manifest = pilotManifestSchema.parse({ version: 2, vault, guardian: sender, operator: sender,
    requests: [{ messageId: f.release.messageId, proof: f.locator }] });
  const bindings: Record<string, unknown> = { ...cctpBindings(vault), token: route.destination.usdc,
    guardian: sender, routeId: keccak256(stringToHex(route.id)), MAX_REVIEW_TTL: 600n,
    RELEASE_POLICY_VERSION: 4n, REVIEW_FORMAT_VERSION: 2n, releaseDelayUntil: 0n,
    releases: [f.release.recipient, f.release.amount, 0, 0n, zeroAddress, 0n, 0] };
  const reader: CctpAuditReader = { ...f.destination.port,
    readVault: vi.fn(async (name) => bindings[name]),
    readGuardian: vi.fn(async (name: Parameters<CctpAuditReader['readGuardian']>[0]) => ({ owner: vault, oracle: sender, GUARDIAN_POLICY_VERSION: 4n,
      isProtected: true, currentTier: 0, getRoute: { windowSeconds: 3600n, cap: 10_000_000n, tierExpiresAt: 0n } })[name]) };
  const dir = mkdtempSync(join(tmpdir(), 'tripwire-pilot-')); dirs.push(dir);
  const stateFile = join(dir, 'state.sqlite');
  return { f, manifest, reader, bindings, stateFile };
}

describe('CCTP observe-only pilot', () => {
  it('uses authenticated receipts and exact amounts but never treats verified backing as payout approval', async () => {
    const s = setup(); const audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    try {
      const report = await audit.tick(s.manifest);
      expect(report.mode).toBe('observe'); expect(report.results[0].evidence).toEqual({ status: 'verified', amount: s.f.release.amount });
      expect(report.results[0].recommendation).toBe('HOLD');
      expect(report.results[0].release?.amount).toBe(s.f.release.amount);
      expect(report.deployment?.rolesSeparated).toBe(true);
      expect(report.counts).toEqual({ verified: 1, pending: 0, unavailable: 0, invalid: 0 });
      expect(audit.store.transactions()).toEqual([]);
    } finally { audit.close(); }
  });
  it('retries a pending mint after restart without double claiming its funding', async () => {
    const s = setup(); const receipt = s.f.destinationReceipt;
    vi.mocked(s.reader.getTransactionReceipt).mockResolvedValue(null);
    let audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    expect((await audit.tick(s.manifest)).counts.pending).toBe(1); audit.close();
    vi.mocked(s.reader.getTransactionReceipt).mockResolvedValue(receipt);
    audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    try {
      expect((await audit.tick(s.manifest)).counts.verified).toBe(1);
      expect((await audit.tick(s.manifest)).counts.verified).toBe(1);
      expect(audit.store.sourceProofs()).toHaveLength(1);
      expect(audit.store.transactions()).toHaveLength(0);
    } finally { audit.close(); }
  });
  it('reports invalid authenticated binding as REJECT without writing a review', async () => {
    const s = setup(); s.f.replaceRequested({ amount: s.f.release.amount + 1n });
    const audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    try { const r = (await audit.tick(s.manifest)).results[0]; expect(r.evidence.status).toBe('invalid');
      expect(r.recommendation).toBe('REJECT'); expect(audit.store.transactions()).toEqual([]);
    } finally { audit.close(); }
  });
  it('isolates an unreadable request, hiding provider credentials', async () => {
    const s = setup(); vi.mocked(s.reader.readVault).mockImplementation(async (name) => {
      if (name === 'releases') throw new Error('https://rpc.invalid/secret-key'); return s.bindings[name];
    });
    const audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    try { const report = await audit.tick(s.manifest); expect(report.counts.unavailable).toBe(1);
      expect(report.results[0].recommendation).toBe('HOLD'); expect(JSON.stringify(report, (_, v) => typeof v === 'bigint' ? String(v) : v)).not.toContain('secret-key');
    } finally { audit.close(); }
  });
  it('refuses manifest scope changes while allowing new proof locators', async () => {
    const s = setup(); const audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    try { await expect(audit.tick({ ...s.manifest, operator: vault })).rejects.toThrow('scope');
      expect((await audit.tick(s.manifest)).counts.verified).toBe(1);
    } finally { audit.close(); }
  });
  it('quarantines a changed finalized state block and stays quarantined after restart', async () => {
    const s = setup(); const audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    vi.mocked(s.reader.readVault).mockImplementation(async (name) => {
      if (name === 'releases') s.f.destination.setHash(`0x${'ff'.repeat(32)}`); return s.bindings[name];
    });
    await expect(audit.tick(s.manifest)).rejects.toThrow('Finalized');
    expect(audit.store.sourceQuarantine()).toBeTruthy(); audit.close();
    await expect(createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true)).rejects.toThrow('quarantined');
  });
  it('accepts an empty pilot manifest before the first transfer and refuses legacy policy', () => {
    const s = setup(); expect(pilotManifestSchema.safeParse({ ...s.manifest, requests: [] }).success).toBe(true);
    expect(pilotManifestSchema.safeParse({ ...s.manifest, version: 1 }).success).toBe(false);
  });
  it('refuses an old policy before opening a journal', async () => {
    const s = setup(); s.bindings.RELEASE_POLICY_VERSION = 1n;
    await expect(createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true)).rejects.toThrow();
    expect(existsSync(s.stateFile)).toBe(false);
  });
  it('still audits explicit legacy manifests without reading policy-v2 guardian state', async () => {
    const s = setup(); const f = fixture();
    s.bindings.releases = [f.release.recipient, f.release.amount, 0, 0n, zeroAddress, 0n, 0];
    const manifest = { ...s.manifest, version: 1, requests: [{ messageId: f.release.messageId, proof: f.locator }] };
    const reader = { ...s.reader, ...f.destination.port };
    const audit = await createCctpAudit(manifest, s.stateFile, f.source.port, reader);
    try { const report = await audit.tick(); expect(report.policy).toBe('legacy-post-mint');
      expect(report.counts.verified).toBe(1); expect(report.results[0].recommendation).toBeUndefined();
      expect(reader.readGuardian).not.toHaveBeenCalled();
    } finally { audit.close(); }
  });
  it('reports guardian role mismatch without claiming readiness', async () => {
    const s = setup(); const original = s.reader.readGuardian;
    s.reader.readGuardian = async (name, block, args) => name === 'oracle' ? vault : original(name, block, args);
    const audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    try { const report = await audit.tick(); expect(report.deployment?.rolesSeparated).toBe(false);
      expect(report.deployment?.operatorMatchesOracle).toBe(false); expect(report.blockers).toHaveLength(3);
    } finally { audit.close(); }
  });
  it.each([3, 4])('does not propose a new review for a terminal state %s', async (state) => {
    const s = setup(); (s.bindings.releases as unknown[])[2] = state;
    const audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    try { expect((await audit.tick()).results[0].recommendation).toBe('NONE'); } finally { audit.close(); }
  });
  it('rechecks the scoped guardian grant while watching', async () => {
    const s = setup(); const audit = await createCctpAudit(s.manifest, s.stateFile, s.f.source.port, s.reader, true);
    const original = s.reader.readGuardian;
    s.reader.readGuardian = async (name, block, args) => name === 'isProtected' ? false : original(name, block, args);
    try { await expect(audit.tick()).rejects.toThrow(); expect(audit.store.transactions()).toEqual([]); }
    finally { audit.close(); }
  });
  it.each([[], ['manifest.json', '--bad'], ['manifest.json', '--interval=0'],
    ['manifest.json', '--interval=10', '--interval=20'], ['manifest.json', 'state.sqlite', 'extra']].map((args) => ({ args })))('rejects malformed CLI args $args', ({ args }) => {
    expect(() => parseObserveArgs(args)).toThrow();
  });
  it('parses bounded watch options without loading a signing key', () => {
    expect(parseObserveArgs(['manifest.json', 'state.sqlite', '--watch', '--interval=30'])).toMatchObject({ watch: true, intervalSeconds: 30 });
  });
  it('allows only one fresh one-shot report output, without changing the watch default', () => {
    expect(parseObserveArgs(['manifest.json', '--report=new.json']).reportPath).toMatch(/new.json$/);
    for (const args of [['manifest.json', '--report=new.json', '--watch'], ['manifest.json', '--report=a', '--report=b'], ['manifest.json', '--report=']]) {
      expect(() => parseObserveArgs(args)).toThrow();
    }
  });
  it('serializes exact public bigint values and refuses to overwrite prior report evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tripwire-observer-report-')); dirs.push(dir);
    const path = join(dir, 'report.json'); saveObservation(path, { amount: 1_000_001n, enforcement: false });
    const before = readFileSync(path, 'utf8'); expect(JSON.parse(before)).toEqual({ amount: '1000001', enforcement: false });
    expect(() => saveObservation(path, { amount: 0n })).toThrow(); expect(readFileSync(path, 'utf8')).toBe(before);
  });
});
