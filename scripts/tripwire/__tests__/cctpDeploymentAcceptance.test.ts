// Synthetic RPC provenance/state vectors, plus actual local-EVM hash coverage in
// runtimeAcceptance.test.ts. No public deployment/keys/signatures/receipts here.
import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { initialPaymentPolicyHash } from '../../../src/chains/evm/paymentPolicy.js';
import { cctpPaymentDeploymentSchema } from '../testnet/cctpDeployPlan.js';
import { acceptCctpDeployment, deploymentReceiptBundleSchema } from '../testnet/cctpDeploymentAcceptance.js';
import { parseAcceptanceArgs } from '../testnet/acceptCctpDeployment.js';

import { input, hash, fixture, screenedInput } from './fixtures/cctpDeployment.js';
import { operatorManifestSchema } from '../testnet/cctpManifest.js';
import { expectedGuardianRuntime, expectedPaymentRuntime } from '../testnet/artifactAcceptance.js';

/** The manifest as it is written to disk (bigints become decimal strings). */
const stringifyable = (value: unknown) => JSON.parse(JSON.stringify(value, (_k, v: unknown) => typeof v === 'bigint' ? v.toString() : v));

describe('receipt-backed initial payment deployment acceptance', () => {
  it('accepts exact finalized initcode/configuration provenance, runtime, policy and the sole grant', async () => {
    const f = fixture(), report = await f.run();
    expect(report.initialDeploymentAccepted).toBe(true); expect(report.status).toBe('accepted'); expect(report.enforcement).toBe(false);
    expect(report.evidence).toHaveLength(4); expect(report.manifest.version).toBe(3);
    if (report.status !== 'accepted') throw new Error('Unexpected pending fixture');
    expect(report.policy.hash).toBe(f.facts.policyHash); expect(report.destinationStartBlock).toBe(100n);
    expect(report.runtime.payment.runtimeBytes).toBeGreaterThan(15_000); expect(report.grants).toHaveLength(1);
    expect(f.reader.readCode.mock.calls.every(([, block]) => block === 200n)).toBe(true);
    expect(f.reader.readVault.mock.calls.every(([, block]) => block === 200n)).toBe(true);
  });
  it('does not invent receipts for an empty template and never reads mutable state or code', async () => {
    const f = fixture(); f.bundle.transactions = [null, null, null, null];
    const report = await f.run(); expect(report.status).toBe('pending'); expect(report.initialDeploymentAccepted).toBe(false);
    expect(report.blockers).toHaveLength(4); expect(f.reader.getTransaction).not.toHaveBeenCalled(); expect(f.reader.readCode).not.toHaveBeenCalled();
  });
  it('keeps missing public receipts pending rather than accepting getters', async () => {
    const f = fixture(); f.reader.getReceipt.mockResolvedValue(null);
    expect((await f.run()).blockers).toHaveLength(4); expect(f.reader.readVault).not.toHaveBeenCalled();
  });
  it('waits for the last receipt to reach the common finalized state snapshot', async () => {
    const f = fixture(); f.setHead(102n);
    expect((await f.run()).blockers).toEqual(['STEP_4_WAIT_FINALITY']); expect(f.reader.readCode).not.toHaveBeenCalled();
  });
  it.each(['package', 'duplicate', 'legacy'] as const)('refuses invalid %s input before contacting RPC', async (bad) => {
    const f = fixture(); let config: unknown = input;
    if (bad === 'package') f.bundle.packageHash = hash(999);
    if (bad === 'duplicate') f.bundle.transactions[1] = f.bundle.transactions[0];
    if (bad === 'legacy') config = { ...input, version: 2 };
    await expect(acceptCctpDeployment(config, f.bundle, f.reader)).rejects.toThrow(); expect(f.reader.getChainId).not.toHaveBeenCalled();
  });
  it.each(['from', 'to', 'input', 'nonce', 'value', 'hash', 'chainId'] as const)('refuses substituted creation transaction %s', async (field) => {
    const f = fixture();
    f.transactions[0][field] = ({ from: actors.oracle.address, to: actors.owner.address, input: '0x6000', nonce: 72, value: 1n, hash: hash(999), chainId: 1 })[field];
    await expect(f.run()).rejects.toThrow('package'); expect(f.reader.readCode).not.toHaveBeenCalled();
  });
  it('refuses changed calldata in either configuration step', async () => {
    for (const step of [2, 3]) { const f = fixture(); f.transactions[step].input = '0x'; await expect(f.run()).rejects.toThrow('package'); }
  });
  it.each(['status', 'contractAddress', 'blockHash', 'blockNumber', 'transactionIndex', 'from', 'to', 'transactionHash'] as const)('refuses contradictory receipt %s', async (field) => {
    const f = fixture(); f.receipts[1][field] = ({ status: 'reverted', contractAddress: actors.oracle.address, blockHash: hash(999), blockNumber: 199n,
      transactionIndex: 1, from: actors.oracle.address, to: actors.owner.address, transactionHash: hash(999) })[field];
    await expect(f.run()).rejects.toThrow();
  });
  it('refuses creation receipts in a noncanonical block', async () => {
    const f = fixture(); f.transactions[0].blockHash = hash(999); f.receipts[0].blockHash = hash(999);
    await expect(f.run()).rejects.toThrow('canonical');
  });
  it('refuses reordered configuration transactions even when their individual payloads match', async () => {
    const f = fixture(); f.transactions[2].blockNumber = f.receipts[2].blockNumber = 104n; f.transactions[2].blockHash = f.receipts[2].blockHash = hash(104);
    await expect(f.run()).rejects.toThrow('order');
  });
  it('accepts package-ordered transactions in one block using their transaction indices', async () => {
    const f = fixture();
    for (let i = 0; i < 4; i++) for (const row of [f.transactions[i], f.receipts[i]]) { row.blockNumber = 100n; row.blockHash = hash(100); row.transactionIndex = i; }
    f.grants[0].blockNumber = 100n; f.grants[0].blockHash = hash(100);
    expect((await f.run()).initialDeploymentAccepted).toBe(true);
  });
  it('refuses changed runtime despite valid receipt and getter markers', async () => {
    const f = fixture(); f.reader.readCode.mockResolvedValue('0x6000'); await expect(f.run()).rejects.toThrow('bytecode');
  });
  it.each(['policyHash', 'policyVersion', 'paymentPolicy', 'queuedChange', 'queuedChangeAt', 'totalCredited', 'totalPaid', 'totalReturned',
    'MAX_REVIEW_TTL', 'POLICY_CHANGE_DELAY', 'paymentsPaused', 'permittedRecipients', 'authorizedSourceSender', 'REVIEW_FORMAT_VERSION'] as const)
  ('refuses changed initial customer %s', async (name) => {
    const f = fixture(); f.facts[name] = name === 'policyHash' || name === 'queuedChange' ? hash(999) : name === 'paymentPolicy' ? [1n, 1n, 1n, 0n]
      : name === 'paymentsPaused' ? true : name === 'permittedRecipients' ? false : name === 'authorizedSourceSender' ? actors.oracle.address : 99n;
    await expect(f.run()).rejects.toThrow();
  });
  it.each(['owner', 'oracle', 'isProtected', 'getRoute'] as const)('refuses changed guardian %s', async (name) => {
    const f = fixture(); f.guardian[name] = name === 'getRoute' ? { ...(f.guardian.getRoute as object), cap: 999n } : name === 'isProtected' ? false : actors.relayer.address;
    await expect(f.run()).rejects.toThrow();
  });
  it.each(['missing', 'extra', 'removed', 'address', 'hash', 'range', 'args'] as const)('refuses incomplete or misleading grant history: %s', async (bad) => {
    const f = fixture();
    if (bad === 'missing') f.grants.splice(0);
    if (bad === 'extra') f.grants.push({ ...f.grants[0], logIndex: 1, args: { ...f.grants[0].args, caller: actors.oracle.address.toLowerCase() as Hex } });
    if (bad === 'removed') f.grants[0].removed = true;
    if (bad === 'address') f.grants[0].address = actors.owner.address;
    if (bad === 'hash') f.grants[0].blockHash = hash(999);
    if (bad === 'range') f.reader.readGuardianGrants.mockImplementation(async () => [{ ...f.grants[0], blockNumber: 99n }]);
    if (bad === 'args') f.grants[0].args.allowed = false;
    await expect(f.run()).rejects.toThrow();
  });
  it('rechecks accepted receipt anchors after all mutable state reads', async () => {
    const f = fixture(), original = f.reader.readGuardianGrants.getMockImplementation();
    f.reader.readGuardianGrants.mockImplementation(async (from, to) => {
      f.reader.getBlock.mockImplementation(async (query) => 'blockNumber' in query && query.blockNumber === 100n
        ? { number: 100n, hash: hash(999), parentHash: hash(99), timestamp: 1_780_000_100n }
        : { number: 'blockNumber' in query ? query.blockNumber : 200n, hash: hash('blockNumber' in query ? query.blockNumber : 200n), parentHash: hash(199), timestamp: 1_780_000_200n });
      return original?.(from, to);
    });
    await expect(f.run()).rejects.toThrow('provenance');
  });
  it('rejects wrong chain or a changed finalized snapshot with empty receipts as well', async () => {
    const f = fixture(); f.reader.getChainId.mockResolvedValue(1); await expect(f.run()).rejects.toThrow('Sepolia');
    const s = fixture(); s.bundle.transactions = [null, null, null, null];
    s.reader.getBlock.mockResolvedValueOnce({ number: 200n, hash: hash(999), parentHash: hash(199), timestamp: 1_780_000_200n });
    await expect(s.run()).rejects.toThrow('state block');
  });
  it('refuses malformed fields rather than coercing string amounts or accepting missing chain ID', async () => {
    const f = fixture(); delete f.transactions[0].chainId; await expect(f.run()).rejects.toThrow();
    const s = fixture(); s.transactions[0].value = '0'; await expect(s.run()).rejects.toThrow();
  });
  it('pins recipient order in the canonical initial hash and exposes strict CLI arguments', () => {
    const cfg = cctpPaymentDeploymentSchema.parse(input), f = fixture();
    const a = initialPaymentPolicyHash(route.destination.chainId, f.plan.contracts.vault, f.plan.routeId, route.destination.usdc, f.plan.contracts.guardian,
      { ...cfg.payment, recipients: [actors.bridge.address, actors.relayer.address] });
    const b = initialPaymentPolicyHash(route.destination.chainId, f.plan.contracts.vault, f.plan.routeId, route.destination.usdc, f.plan.contracts.guardian,
      { ...cfg.payment, recipients: [actors.relayer.address, actors.bridge.address] });
    expect(a).not.toBe(b); expect(parseAcceptanceArgs(['--template', 'config.json', 'new.json']).mode).toBe('template');
    expect(parseAcceptanceArgs(['config.json', 'receipts.json', 'new.json']).mode).toBe('check');
    expect(() => parseAcceptanceArgs(['config.json', 'receipts.json'])).toThrow();
    expect(() => deploymentReceiptBundleSchema.parse({ ...f.bundle, approved: true })).toThrow();
  });
});

describe('receipt-backed initial screened deployment acceptance (ADR-047/048)', () => {
  it('accepts a paused, legacy-mode screened escrow with the exact profile and no head, and emits manifest 4', async () => {
    const f = fixture(screenedInput), report = await f.run();
    expect(report.status).toBe('accepted');
    if (report.status !== 'accepted') throw new Error('Unexpected pending fixture');
    expect(report.manifest.version).toBe(4); expect(operatorManifestSchema.parse(stringifyable(report.manifest))).toMatchObject({ version: 4 });
    expect(report.screening).toMatchObject({ profileHash: f.facts.screeningProfileHash, startsPaused: true, executionMode: 'legacy', activeHead: null });
    expect(report.runtime.payment.runtimeBytes).toBe(23_430);
    expect(report.remainingGates.at(-1)).toContain('paused in legacy mode');
  });
  it.each([
    ['unpaused', (f: ReturnType<typeof fixture>) => { f.facts.paymentsPaused = false; }, 'not paused'],
    ['already advisory', (f: ReturnType<typeof fixture>) => { f.facts.executionMode = 1; }, 'legacy mode'],
    ['carrying a list head', (f: ReturnType<typeof fixture>) => { f.facts.activeHead = [hash(5), 1n, 1n, 2n]; }, 'list head'],
    ['another profile hash', (f: ReturnType<typeof fixture>) => { f.facts.screeningProfileHash = hash(5); }, 'profile hash differs'],
    ['other profile fields', (f: ReturnType<typeof fixture>) => { (f.facts.screeningProfile as unknown[])[4] = 7200; }, 'profile fields'],
    ['the plain payment runtime', (f: ReturnType<typeof fixture>) => { f.reader.readCode.mockImplementation(async (address: Hex) => address === f.plan.contracts.guardian
      ? expectedGuardianRuntime(address) : expectedPaymentRuntime(f.plan.contracts.vault, f.plan.contracts.guardian,
        { authority: actors.owner.address, sourceSender: actors.owner.address, returnRecipient: actors.owner.address, recoveryDelay: 3600n })); }, 'bytecode'],
    ['review format 3', (f: ReturnType<typeof fixture>) => { f.facts.REVIEW_FORMAT_VERSION = 3n; }, 'REVIEW_FORMAT_VERSION'],
    ['the v1 initial policy hash', (f: ReturnType<typeof fixture>) => { f.facts.policyHash = hash(77); }, 'policy hash'],
  ] as const)('refuses a fresh screened escrow %s', async (_label, change, reason) => {
    const f = fixture(screenedInput); change(f);
    await expect(f.run()).rejects.toThrow(reason);
  });
  it('a screened config never yields a version-3 package, and a version-3 config never a screened one', () => {
    expect(fixture(screenedInput).plan.manifest.version).toBe(4);
    expect(fixture().plan.manifest.version).toBe(3);
    expect(fixture().plan.screening).toBeUndefined();
  });
});
