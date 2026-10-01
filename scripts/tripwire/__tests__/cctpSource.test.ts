import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toHex, type Hex } from 'viem';
import { decodeCctpMessage, cctpReleaseId } from '../../../src/chains/evm/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { CctpSourceAdapter } from '../cctp.js';
import { MemoryFeed, type BurnEvent, type ReleaseEvent } from '../events.js';
import { FinalityConflictError } from '../finality.js';
import { OperatorStore } from '../store.js';
import { Watcher } from '../watch.js';
import { ReleaseDecision, releaseDecision } from '../review.js';
import { cctpManifestSchema } from '../testnet/verifyCctp.js';
import { addressWord, beneficiary, bytesReplace, fixture, nonce, scope, sender, vault } from './fixtures/cctp.js';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const fn of cleanups.reverse()) fn(); cleanups.length = 0; });
function open(path?: string) {
  if (!path) { const dir = mkdtempSync(join(tmpdir(), 'tripwire-cctp-')); path = join(dir, 'operator.sqlite'); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); }
  const store = new OperatorStore(path, scope); cleanups.push(() => store.close()); return { store, path };
}
function setup(f = fixture()) {
  const { store, path } = open(); const locate = vi.fn(async () => f.locator);
  const adapter = new CctpSourceAdapter(store, vault, f.source.port, f.destination.port, locate, 'legacy-post-mint');
  return { ...f, store, path, adapter, locate };
}

describe('CCTP v2 USDC source authentication', () => {
  it('rejects duplicate or malformed external manifest entries before opening an audit', () => {
    const f = fixture(); const request = { messageId: f.release.messageId, proof: f.locator };
    const manifest = { version: 1, vault, guardian: sender, operator: sender, requests: [request] };
    expect(cctpManifestSchema.safeParse(manifest).success).toBe(true);
    for (const requests of [[request, request], [{ ...request, proof: { ...f.locator, sourceLogIndex: -1 } }]]) {
      expect(cctpManifestSchema.safeParse({ ...manifest, requests }).success).toBe(false);
    }
  });
  it('decodes the protocol vector and verifies exact net escrow backing beyond Number precision', async () => {
    const f = setup(fixture(10n ** 30n + 1n, 1n));
    expect(decodeCctpMessage(f.message).body.amount).toBe(10n ** 30n + 1n);
    expect(await f.adapter.verify(f.release)).toEqual({ status: 'verified', amount: 10n ** 30n });
    expect(f.store.sourceProofs()[0]).toMatchObject({ amount: 10n ** 30n, nonce, recipient: beneficiary });
  });
  it.each([
    ['source domain', 4, toHex(0, { size: 4 })], ['destination domain', 8, toHex(1, { size: 4 })],
    ['source messenger', 44, addressWord(sender)], ['destination messenger', 76, addressWord(sender)],
    ['source token', 152, addressWord(sender)], ['mint recipient', 184, addressWord(beneficiary)],
  ])('rejects an authenticated message with the wrong %s', async (_field, offset, replacement) => {
    const f = setup(); f.replaceMessage(bytesReplace(f.message, offset as number, replacement as Hex));
    expect((await f.adapter.verify(f.release)).status).toBe('invalid'); expect(f.store.sourceProofs()).toEqual([]);
  });
  it.each(['source', 'destination'])('holds when the %s RPC is on another chain', async (side) => {
    const f = setup(); vi.mocked(side === 'source' ? f.source.port.getChainId : f.destination.port.getChainId).mockResolvedValue(1);
    expect((await f.adapter.verify(f.release)).status).toBe('unavailable');
  });
  it('rejects wrong source contract, log identity and a reused source under another release ID', async () => {
    const f = setup(); f.sourceReceipt.logs[0].address = sender;
    expect((await f.adapter.verify(f.release)).status).toBe('invalid');
    expect((await f.adapter.verify({ ...f.release, messageId: nonce })).status).toBe('invalid');
  });
  it('binds the end beneficiary and exact payout including fees, with no 1% slack', async () => {
    const f = setup();
    for (const changed of [{ ...f.release, recipient: sender }, { ...f.release, amount: f.release.amount + 1n },
      { ...f.release, amount: f.release.amount - 1n }]) expect((await f.adapter.verify(changed)).status).toBe('invalid');
    expect((await f.adapter.verify(f.release)).status).toBe('verified');
  });
  it.each(['source', 'destination'])('holds a missing or unfinalized %s receipt and retries when it finalizes', async (side) => {
    const f = setup(); const rpc = side === 'source' ? f.source : f.destination;
    vi.mocked(rpc.port.getTransactionReceipt).mockResolvedValueOnce(null);
    expect((await f.adapter.verify(f.release)).status).toBe('pending');
    rpc.setFinalized(0n); expect((await f.adapter.verify(f.release)).status).toBe('pending');
    rpc.setFinalized(side === 'source' ? 100n : 200n); expect((await f.adapter.verify(f.release)).status).toBe('verified');
  });
  it('never credits an unfunded vault from a burn alone', async () => {
    const f = setup(); f.locate.mockResolvedValueOnce({ ...f.locator, destinationTransactionHash: undefined });
    expect((await f.adapter.verify(f.release)).status).toBe('pending'); expect(f.store.sourceProofs()).toEqual([]);
  });
  it.each(['fast source', 'fast receive', 'unknown version', 'unknown hook', 'nonzero padding'])('holds unsupported %s', async (which) => {
    const f = setup();
    if (which === 'fast source') f.replaceMessage(bytesReplace(f.message, 140, toHex(1000, { size: 4 })));
    if (which === 'fast receive') f.replaceReceive({ finalityThresholdExecuted: 1000 });
    if (which === 'unknown version') f.replaceMessage(bytesReplace(f.message, 0, toHex(2, { size: 4 })));
    if (which === 'unknown hook') f.replaceMessage(bytesReplace(f.message, 376, nonce));
    if (which === 'nonzero padding') f.replaceMessage(bytesReplace(f.message, 152, nonce));
    expect((await f.adapter.verify(f.release)).status).toBe('unavailable');
  });
  it('requires a matching real DepositForBurn and refuses ambiguous batches', async () => {
    const f = setup(); f.replaceDeposit({ amount: 1n });
    expect((await f.adapter.verify(f.release)).status).toBe('invalid');
    f.replaceDeposit({}); f.sourceReceipt.logs.push({ ...f.sourceReceipt.logs[1], logIndex: 9 });
    expect((await f.adapter.verify(f.release)).status).toBe('unavailable');
  });
  it.each(['token', 'recipient', 'amount', 'fee', 'domain', 'body', 'expiry', 'caller'])('rejects mismatched destination %s', async (which) => {
    const f = setup();
    if (which === 'token') f.replaceMint({ mintToken: sender });
    if (which === 'recipient') f.replaceMint({ mintRecipient: beneficiary });
    if (which === 'amount') f.replaceMint({ amount: f.release.amount + 1n });
    if (which === 'fee') f.replaceReceive({ messageBody: bytesReplace(f.receivedBody, 164, toHex(1001n, { size: 32 })) });
    if (which === 'domain') f.replaceReceive({ sourceDomain: 1 });
    if (which === 'body') f.replaceReceive({ messageBody: bytesReplace(f.receivedBody, 100, addressWord(beneficiary)) });
    if (which === 'expiry') f.replaceReceive({ messageBody: bytesReplace(f.receivedBody, 196, toHex(200n, { size: 32 })) });
    if (which === 'caller') { f.replaceMessage(bytesReplace(f.message, 108, addressWord(beneficiary))); f.replaceDeposit({ destinationCaller: addressWord(beneficiary) }); }
    expect((await f.adapter.verify(f.release)).status).toBe('invalid');
  });
  it.each(['removed', 'hash', 'duplicate', 'wrong transaction', 'bad event', 'RPC exception'])('holds malformed evidence: %s', async (which) => {
    const f = setup();
    if (which === 'removed') f.sourceReceipt.logs[0].removed = true;
    if (which === 'hash') f.sourceReceipt.logs[0].blockHash = nonce;
    if (which === 'duplicate') f.sourceReceipt.logs.push(f.sourceReceipt.logs[0]);
    if (which === 'wrong transaction') f.destinationReceipt.transactionHash = nonce;
    if (which === 'bad event') f.destinationReceipt.logs[0].data = '0x';
    if (which === 'RPC exception') vi.mocked(f.source.port.getBlock).mockRejectedValueOnce(new Error('provider unavailable'));
    expect((await f.adapter.verify(f.release)).status).toBe('unavailable'); expect(f.store.sourceProofs()).toEqual([]);
  });
  it('commits proof before VERIFIED, retries a failed disk write, and remains idempotent on restart', async () => {
    const f = setup(); vi.spyOn(f.store, 'saveSourceProof').mockImplementationOnce(() => { throw new Error('Disk full'); });
    expect((await f.adapter.verify(f.release)).status).toBe('unavailable'); expect(f.store.sourceProofs()).toEqual([]);
    expect((await f.adapter.verify(f.release)).status).toBe('verified'); f.store.close();
    const restored = open(f.path).store;
    const locator = vi.fn(async () => null);
    const adapter = new CctpSourceAdapter(restored, vault, f.source.port, f.destination.port, locator, 'legacy-post-mint');
    expect((await adapter.verify(f.release)).status).toBe('verified'); expect(locator).not.toHaveBeenCalled();
    expect((await adapter.verify({ ...f.release, amount: 1n })).status).toBe('invalid'); expect(restored.sourceProofs()).toHaveLength(1);
  });
  it('prevents two burns claiming the same destination mint/nonce across restart', async () => {
    const f = setup(); expect((await f.adapter.verify(f.release)).status).toBe('verified'); f.store.close();
    const second = fixture(); const hash = `0x${'dd'.repeat(32)}` as Hex;
    second.sourceReceipt.transactionHash = hash; for (const log of second.sourceReceipt.logs) log.transactionHash = hash;
    second.locator.sourceTransactionHash = hash;
    second.release.messageId = cctpReleaseId(route.source.chainId, route.source.transmitter, hash, 3);
    const adapter = new CctpSourceAdapter(open(f.path).store, vault, second.source.port, second.destination.port, async () => second.locator, 'legacy-post-mint');
    expect((await adapter.verify(second.release)).status).toBe('invalid');
  });
  it('rejects a reused Circle nonce even with distinct source and destination transaction identities', async () => {
    const f = setup(); await f.adapter.verify(f.release);
    const second = fixture(); const hash = `0x${'dd'.repeat(32)}` as Hex; const destHash = `0x${'ee'.repeat(32)}` as Hex;
    second.sourceReceipt.transactionHash = hash; for (const log of second.sourceReceipt.logs) log.transactionHash = hash;
    second.destinationReceipt.transactionHash = destHash; for (const log of second.destinationReceipt.logs) log.transactionHash = destHash;
    second.locator.sourceTransactionHash = hash; second.locator.destinationTransactionHash = destHash;
    second.release.messageId = cctpReleaseId(route.source.chainId, route.source.transmitter, hash, 3);
    const adapter = new CctpSourceAdapter(f.store, vault, second.source.port, second.destination.port, async () => second.locator, 'legacy-post-mint');
    expect((await adapter.verify(second.release)).status).toBe('invalid'); expect(f.store.sourceProofs()).toHaveLength(1);
  });
  it('holds a receipt that changes during collection and never commits backing from that fork', async () => {
    const f = setup(); vi.mocked(f.destination.port.getTransactionReceipt).mockImplementationOnce(async () => {
      f.source.setHash(nonce); return f.destinationReceipt;
    });
    expect((await f.adapter.verify(f.release)).status).toBe('pending'); expect(f.store.sourceProofs()).toEqual([]);
  });
  it('keeps cached proof intact while a finalized RPC lags and refuses publication safety', async () => {
    const f = setup(); await f.adapter.verify(f.release); f.source.setFinalized(99n);
    expect((await f.adapter.verify(f.release)).status).toBe('unavailable');
    await expect(f.adapter.assertCanonical()).rejects.toThrow('behind'); expect(f.store.sourceProofs()).toHaveLength(1);
  });
  it('feeds verified USDC into the watcher and never makes burn-only evidence an ALLOW', async () => {
    const f = setup(); const release = { ...f.release, origin: { chainId: route.destination.chainId, address: vault,
      blockNumber: 200n, blockHash: f.destinationReceipt.blockHash, transactionHash: f.destinationReceipt.transactionHash, logIndex: 7 } };
    const ingress = new MemoryFeed<BurnEvent>(); const egress = new MemoryFeed<ReleaseEvent>(); egress.emit(release);
    const cp = (address: string, chainId: number, block: bigint, hash: Hex) => JSON.stringify({ version: 1, policy: 'finalized', address, chainId,
      event: 'Event', from: '0', next: String(block + 1n), anchor: { number: String(block), hash } });
    vi.spyOn(ingress, 'checkpoint').mockReturnValue(cp(route.source.transmitter, route.source.chainId, 100n, f.sourceReceipt.blockHash));
    vi.spyOn(egress, 'checkpoint').mockReturnValue(cp(vault, route.destination.chainId, 200n, f.destinationReceipt.blockHash));
    vi.spyOn(ingress, 'restore').mockImplementation(() => undefined); vi.spyOn(egress, 'restore').mockImplementation(() => undefined);
    const watcher = new Watcher({ route: scope.route, chain: 'ethereum', token: 'USDC', decimals: 6, bridge: vault,
      ingress: Object.assign(ingress, { assertCanonical: async () => undefined }), egress: Object.assign(egress, { assertCanonical: async () => undefined }),
      baseline: { route: scope.route, computedAt: release.timestamp, windowHours: 24, sampleSize: 100, medianTransferUsd: 10_000,
        p95TransferUsd: 100_000, rollingTvlUsd: 40_000_000 }, screening: { isFlagged: () => false, describe: () => undefined },
      now: () => release.timestamp, store: f.store, sourceAdapter: f.adapter, payoutToleranceBps: 0n });
    f.locate.mockResolvedValueOnce({ ...f.locator, destinationTransactionHash: undefined });
    expect(releaseDecision((await watcher.tick())[0])).toBe(ReleaseDecision.HOLD);
    expect(releaseDecision((await watcher.tick())[0])).toBe(ReleaseDecision.ALLOW);
    expect(f.store.sourceProofs()).toHaveLength(1);
  });
  it.each(['source', 'destination'])('quarantines changed authenticated finalized %s blocks through the watcher', async (side) => {
    const f = setup(); expect((await f.adapter.verify(f.release)).status).toBe('verified');
    const ingress = new MemoryFeed<BurnEvent>(); const egress = new MemoryFeed<ReleaseEvent>();
    const checkpoint = (address: string, chainId: number) => JSON.stringify({ version: 1, policy: 'finalized', address, chainId,
      event: 'Event', from: '0', next: '0', anchor: null });
    vi.spyOn(ingress, 'checkpoint').mockReturnValue(checkpoint(route.source.transmitter, route.source.chainId));
    vi.spyOn(egress, 'checkpoint').mockReturnValue(checkpoint(vault, route.destination.chainId));
    vi.spyOn(ingress, 'restore').mockImplementation(() => undefined); vi.spyOn(egress, 'restore').mockImplementation(() => undefined);
    const feed = Object.assign(ingress, { assertCanonical: async () => undefined });
    const out = Object.assign(egress, { assertCanonical: async () => undefined });
    const watcher = new Watcher({ route: scope.route, chain: 'ethereum', token: 'USDC', decimals: 6, bridge: vault,
      ingress: feed, egress: out, baseline: null, screening: { isFlagged: () => false, describe: () => undefined }, now: () => f.release.timestamp, store: f.store, sourceAdapter: f.adapter });
    (side === 'source' ? f.source : f.destination).setHash(nonce);
    await watcher.tick(); expect(watcher.quarantineReason).toContain('CCTP proof block changed');
    await expect(watcher.assertCanonical()).rejects.toBeInstanceOf(FinalityConflictError);
    expect(f.store.loadWatcher()?.quarantine).toContain('CCTP');
  });
  it('persists a standalone proof conflict even before a watcher exists and refuses restart with healthy-looking RPCs', async () => {
    const f = setup(); await f.adapter.verify(f.release); f.source.setHash(nonce);
    await expect(f.adapter.assertCanonical()).rejects.toBeInstanceOf(FinalityConflictError);
    expect(f.store.loadWatcher()).toBeNull(); f.store.close();
    const restored = open(f.path).store; f.source.setHash(f.sourceReceipt.blockHash);
    const adapter = new CctpSourceAdapter(restored, vault, f.source.port, f.destination.port, f.locate, 'legacy-post-mint');
    await expect(adapter.verify(f.release)).rejects.toThrow('source quarantine');
  });
  it('refuses a scope change, adapter downgrade and corrupt proof journal', async () => {
    const f = setup(); await f.adapter.verify(f.release);
    expect(() => new CctpSourceAdapter(f.store, sender, f.source.port, f.destination.port, f.locate, 'legacy-post-mint')).toThrow('scope');
    expect(() => new Watcher({ route: scope.route, chain: 'ethereum', token: 'USDC', decimals: 6, bridge: vault,
      ingress: new MemoryFeed<BurnEvent>(), egress: new MemoryFeed<ReleaseEvent>(), baseline: null,
      screening: { isFlagged: () => false, describe: () => undefined }, now: () => 0, store: f.store })).toThrow('Source adapter');
    f.store.close(); const db = new DatabaseSync(f.path); db.prepare('UPDATE source_proofs SET nonce=?').run(`0x${'ee'.repeat(32)}`); db.close();
    expect(() => new OperatorStore(f.path, scope)).toThrow('identity is corrupt');
  });
});
