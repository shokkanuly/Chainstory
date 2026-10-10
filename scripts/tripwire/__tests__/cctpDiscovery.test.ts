import { describe, expect, it } from 'vitest';
import { toHex } from 'viem';
import { discoverCctpRequests, DISCOVERY_BLOCK_LIMIT } from '../testnet/cctpDiscovery.js';
import { parseObserveArgs } from '../testnet/observeCctp.js';
import { FinalityConflictError } from '../finality.js';
import { discoveryFixture } from './fixtures/cctpDiscovery.js';
import { bytesReplace, addressWord } from './fixtures/cctp.js';
const signal = () => new AbortController().signal;
describe('bounded automatic customer operation discovery', () => {
  it('builds exact source-log and destination receipt locators from a matched operation', async () => {
    const s = discoveryFixture(), result = await discoverCctpRequests(s.manifest, s.clients, s.starts, signal());
    expect(result.manifest.requests).toEqual([{ messageId: s.f.release.messageId, proof: s.f.locator }]);
    expect(result.metadata.counts).toEqual({ sourceHints: 1, destinationHints: 1, paired: 1 });
    expect(result.metadata.source).toMatchObject({ from: 100n, through: { number: 101n } });
    expect(result.metadata.destination.through.number).toBe(201n); expect(result.metadata.pendingSource).toEqual([]);
    await result.assertCanonical();
  });
  it('pins complete ranges even when the finalized tip advances during scanning', async () => {
    const s = discoveryFixture(), original = s.source.getBlock.getMockImplementation();
    if (!original) throw new Error('Fixture missing.');
    let read = 0;
    s.source.getBlock.mockImplementation(async (args) => { if (args.blockTag === 'finalized' && ++read > 1) s.source.setHead(150n); return original(args); });
    const r = await discoverCctpRequests(s.manifest, s.clients, s.starts, signal());
    expect(r.metadata.source.through.number).toBe(101n);
    expect(s.source.getContractEvents).toHaveBeenCalledWith(expect.objectContaining({ toBlock: 101n }));
  });
  it('uses existing hash-linked 64-block paging without extending past the selected head', async () => {
    const s = discoveryFixture(); s.source.setHead(170n); s.destination.setHead(270n);
    const r = await discoverCctpRequests(s.manifest, s.clients, s.starts, signal());
    expect(s.source.getContractEvents.mock.calls.map(([a]) => [a.fromBlock, a.toBlock])).toEqual([[100n, 163n], [164n, 170n]]);
    expect(s.destination.getContractEvents.mock.calls.map(([a]) => [a.fromBlock, a.toBlock])).toEqual([[200n, 263n], [264n, 270n]]);
    expect(r.manifest.requests).toHaveLength(1);
  });
  it('keeps unmatched source hints separate from verified unminted amounts', async () => {
    const s = discoveryFixture(); s.destinationEvents.length = 0;
    const r = await discoverCctpRequests(s.manifest, s.clients, s.starts, signal());
    expect(r.manifest.requests).toEqual([]); expect(r.metadata.pendingSource).toHaveLength(1);
    expect(r.metadata.pendingSource[0]).toMatchObject({ operationId: s.f.intent.operationId, transactionHash: s.f.locator.sourceTransactionHash });
    expect('amount' in r.metadata.pendingSource[0]).toBe(false);
  });
  it.each(['missing-source', 'policy', 'return', 'duplicate-source', 'duplicate-destination'] as const)('does not choose a locator for %s', async (failure) => {
    const s = discoveryFixture();
    if (failure === 'missing-source') s.sourceEvents.length = 0;
    if (failure === 'policy') s.destinationEvents[0].args.intentPolicyHash = toHex(999, { size: 32 });
    if (failure === 'return') s.destinationEvents[0].args.returnRecipient = s.manifest.vault;
    if (failure === 'duplicate-source') s.sourceEvents.push({ ...s.sourceEvents[0], logIndex: 4, transactionHash: toHex(888, { size: 32 }) });
    if (failure === 'duplicate-destination') s.destinationEvents.push({ ...s.destinationEvents[0], logIndex: 8, transactionHash: toHex(888, { size: 32 }) });
    const r = await discoverCctpRequests(s.manifest, s.clients, s.starts, signal());
    expect(r.manifest.requests).toEqual([]); expect(r.metadata.unmatchedDestination.length).toBe(failure === 'duplicate-destination' ? 2 : 1);
    if (failure.startsWith('duplicate')) expect(r.metadata.conflicts).toEqual([s.f.intent.operationId]);
  });
  it.each(['unsupported', 'caller', 'sender', 'token', 'destination', 'fast'] as const)('skips unsupported/out-of-scope source %s without approving destination hints', async (failure) => {
    const s = discoveryFixture();
    const changed = failure === 'unsupported' ? '0x12' : failure === 'caller' ? bytesReplace(s.f.message, 108, addressWord(s.manifest.guardian))
      : failure === 'sender' ? bytesReplace(s.f.message, 248, addressWord(s.manifest.vault))
      : failure === 'token' ? bytesReplace(s.f.message, 152, addressWord(s.manifest.vault))
      : failure === 'destination' ? bytesReplace(s.f.message, 184, addressWord(s.manifest.guardian))
      : bytesReplace(s.f.message, 140, '0x000003e8');
    s.sourceEvents[0].args.message = changed;
    const r = await discoverCctpRequests(s.manifest, s.clients, s.starts, signal());
    expect(r.metadata.counts.paired).toBe(0); expect(r.metadata.unmatchedDestination).toHaveLength(1);
  });
  it.each(['removed', 'block-hash', 'duplicate-position', 'broken-chain', 'missing-finality', 'RPC', 'malformed-binding'] as const)('returns no partial manifest on %s', async (failure) => {
    const s = discoveryFixture();
    if (failure === 'removed') s.destinationEvents[0].removed = true;
    if (failure === 'block-hash') s.destinationEvents[0].blockHash = toHex(999, { size: 32 });
    if (failure === 'duplicate-position') s.destinationEvents.push(s.destinationEvents[0]);
    if (failure === 'broken-chain') s.source.getBlock.mockImplementation(async (args) => ({ ...s.source.block(args.blockNumber ?? 101n), parentHash: toHex(999, { size: 32 }) }));
    if (failure === 'missing-finality' || failure === 'RPC') s.source.getBlock.mockRejectedValue(new Error('RPC unavailable'));
    if (failure === 'malformed-binding') s.destinationEvents[0].args.operationId = 'not-a-hash';
    await expect(discoverCctpRequests(s.manifest, s.clients, s.starts, signal())).rejects.toThrow();
  });
  it('detects a committed scan anchor change after discovery, before export', async () => {
    const s = discoveryFixture(), r = await discoverCctpRequests(s.manifest, s.clients, s.starts, signal());
    const original = s.source.getBlock.getMockImplementation(); if (!original) throw new Error('Fixture missing.');
    s.source.getBlock.mockImplementation(async (args) => ({ ...await original(args), hash: toHex(999, { size: 32 }) }));
    await expect(r.assertCanonical()).rejects.toBeInstanceOf(FinalityConflictError);
  });
  it('rechecks captured block clocks after receipt auditing, before export', async () => {
    const s = discoveryFixture(), r = await discoverCctpRequests(s.manifest, s.clients, s.starts, signal());
    const original = s.destination.getBlock.getMockImplementation(); if (!original) throw new Error('Fixture missing.');
    s.destination.getBlock.mockImplementation(async (args) => ({ ...await original(args), timestamp: 1n }));
    await expect(r.assertCanonical()).rejects.toThrow('snapshot changed');
  });
  it.each(['negative', 'ahead', 'too-large', 'wrong-chain', 'manual', 'legacy', 'too-many'] as const)('refuses unsupported bounds/scope %s', async (failure) => {
    const s = discoveryFixture();
    if (failure === 'negative') s.starts.source = -1n;
    if (failure === 'ahead') s.starts.destination = 202n;
    if (failure === 'too-large') s.source.setHead(100n + DISCOVERY_BLOCK_LIMIT);
    if (failure === 'wrong-chain') s.clients.source.pub.getChainId.mockResolvedValue(1);
    const input = failure === 'manual' ? { ...s.manifest, requests: [{ messageId: s.f.release.messageId, proof: s.f.locator }] }
      : failure === 'legacy' ? { ...s.manifest, version: 2, payment: undefined } : s.manifest;
    if (failure === 'too-many') for (let i = 1; i <= 100; i++) s.destinationEvents.push({ ...s.destinationEvents[0], logIndex: i + 10 });
    await expect(discoverCctpRequests(input, s.clients, s.starts, signal())).rejects.toThrow();
  });
  it('honors cancellation and does not fetch new pages', async () => {
    const s = discoveryFixture(), abort = new AbortController(); abort.abort();
    await expect(discoverCctpRequests(s.manifest, s.clients, s.starts, abort.signal)).rejects.toThrow('canceled');
    expect(s.source.getContractEvents).not.toHaveBeenCalled(); expect(s.destination.getContractEvents).not.toHaveBeenCalled();
  });
  it('accepts explicit one-shot discovery arguments and refuses watch/duplicate/ambiguous bounds', () => {
    expect(parseObserveArgs(['manifest.json', '--discover=100:200', '--report=report.json']).discovery).toEqual({ source: 100n, destination: 200n });
    for (const args of [['--discover=100:200', '--watch'], ['--discover=100:200', '--discover=101:201'], ['--discover=-1:0'],
      ['--discover=01:200'], ['--discover=1.5:200'], ['--discover=1'], ['--discover='], [`--discover=${1n << 256n}:200`]]) expect(() => parseObserveArgs(['manifest.json', ...args])).toThrow();
  });
});
