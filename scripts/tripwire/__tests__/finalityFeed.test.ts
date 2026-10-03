import { describe, expect, it, vi } from 'vitest';
import { parseAbi, type Hex } from 'viem';
import { burnEventSchema } from '../events.js';
import { ContractEventFeed, type Clients } from '../testnet/sepolia.js';
import { FinalityConflictError } from '../finality.js';

const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex;
const address = `0x${'a'.repeat(40)}` as Hex;
const messageId = hash(100);
function fixture() {
  let finalized = 12n;
  const safe = 15n;
  const blocks = new Map(Array.from({ length: 20 }, (_, n) => [BigInt(n), { number: BigInt(n), hash: hash(n + 1), parentHash: hash(n), timestamp: 1000n + BigInt(n) }]));
  const getBlock = vi.fn(async (arg: { blockTag?: string; blockNumber?: bigint }) => blocks.get(arg.blockTag === 'finalized' ? finalized
    : arg.blockTag === 'safe' ? safe : arg.blockNumber ?? 19n));
  const event = (n = 11) => ({ address, blockNumber: BigInt(n), blockHash: blocks.get(BigInt(n))?.hash, transactionHash: hash(200), logIndex: 0, removed: false,
    args: { messageId, amount: 40_000n } });
  const getContractEvents = vi.fn().mockResolvedValue([event()]);
  const clients = { chainId: 11155111, pub: { getBlock, getContractEvents, getBlockNumber: vi.fn(async () => 19n) } } as unknown as Clients;
  const make = (finality: 'finalized' | 'safe' = 'finalized') => new ContractEventFeed(clients, address, parseAbi(['event Burned(bytes32 messageId, uint256 amount)']), 'Burned', 10n,
    (args, timestamp) => burnEventSchema.parse({ ...args, timestamp }), { finality });
  return { make, blocks, getBlock, getContractEvents, event, setFinalized: (n: bigint) => { finalized = n; } };
}
describe('safe-head release ingestion (MED-2)', () => {
  it('reads up to the safe head with the same hash-linked, policy-bound checkpoint', async () => {
    const f = fixture(); const feed = f.make('safe');
    expect(await feed.poll()).toHaveLength(1);
    expect(f.getContractEvents).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 10n, toBlock: 15n }));
    expect(JSON.parse(feed.checkpoint())).toMatchObject({ policy: 'safe', next: '16', anchor: { number: '15' } });
    expect(() => f.make('finalized').restore(feed.checkpoint())).toThrow('does not match');
    expect(() => f.make('safe').restore(f.make('finalized').checkpoint())).toThrow('does not match');
  });
  it('quarantines when a block it read at the safe head is reorganised away', async () => {
    const f = fixture(); const feed = f.make('safe'); await feed.poll();
    const block = f.blocks.get(15n); if (!block) throw new Error('fixture'); f.blocks.set(15n, { ...block, hash: hash(999) });
    await expect(feed.assertCanonical()).rejects.toBeInstanceOf(FinalityConflictError);
  });
});

describe('finalized event ingestion', () => {
  it('passes validated provenance to protocol mappers and advances over explicitly skipped unrelated messages', async () => {
    const f = fixture();
    const mapper = vi.fn().mockReturnValue(null);
    const base = f.make(); const saved = JSON.parse(base.checkpoint());
    const clients = { chainId: 11155111, pub: { getBlock: f.getBlock, getContractEvents: f.getContractEvents } } as unknown as Clients;
    const feed = new ContractEventFeed(clients, address, parseAbi(['event Burned(bytes32 messageId, uint256 amount)']),
      'Burned', 10n, mapper, { finality: 'finalized' });
    expect(await feed.poll()).toEqual([]);
    expect(mapper).toHaveBeenCalledWith(f.event().args, 1011, expect.objectContaining({ transactionHash: hash(200), logIndex: 0 }));
    expect(JSON.parse(feed.checkpoint()).next).toBe('13'); expect(saved.next).toBe('10');
  });
  it('rejects headers mixed from different forks even when their log hashes individually match', async () => {
    const f = fixture(); const feed = f.make(); const before = feed.checkpoint();
    const b = f.blocks.get(11n); if (b) f.blocks.set(11n, { ...b, parentHash: hash(999) });
    await expect(feed.poll()).rejects.toThrow('one canonical chain'); expect(feed.checkpoint()).toBe(before);
    expect(f.getContractEvents).not.toHaveBeenCalled();
  });
  it('binds restored checkpoints to the chain, contract, event and start block', async () => {
    const f = fixture(); const saved = JSON.parse(f.make().checkpoint());
    for (const patch of [{ chainId: 1 }, { address: `0x${'b'.repeat(40)}` }, { event: 'OtherEvent' }, { from: '9' }]) {
      expect(() => f.make().restore(JSON.stringify({ ...saved, ...patch }))).toThrow();
    }
  });

  it('queries only finalized blocks and persists a hash-bound checkpoint with event provenance', async () => {
    const f = fixture(); const feed = f.make(); const events = await feed.poll();
    expect(f.getContractEvents).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 10n, toBlock: 12n }));
    expect(events[0].origin).toMatchObject({ blockNumber: 11n, blockHash: hash(12), transactionHash: hash(200), logIndex: 0 });
    const restored = f.make(); restored.restore(feed.checkpoint());
    f.getContractEvents.mockResolvedValue([]); await restored.poll();
    expect(f.getContractEvents).toHaveBeenCalledTimes(1);
  });
  it('detects a changed committed block even when there are no new events', async () => {
    const f = fixture(); const feed = f.make(); await feed.poll(); const saved = feed.checkpoint();
    const block = f.blocks.get(12n); if (!block) throw new Error('fixture'); f.blocks.set(12n, { ...block, hash: hash(999) });
    const restored = f.make(); restored.restore(saved);
    await expect(restored.poll()).rejects.toBeInstanceOf(FinalityConflictError); expect(restored.checkpoint()).toBe(saved);
  });
  it('treats a lagging finalized RPC as unavailable, rather than rewinding or declaring a reorg', async () => {
    const f = fixture(); const feed = f.make(); await feed.poll(); const saved = feed.checkpoint(); f.setFinalized(10n);
    await expect(feed.poll()).rejects.toThrow('behind'); expect(feed.checkpoint()).toBe(saved);
  });
  it.each(['removed', 'hash', 'range', 'address', 'duplicate'])('rejects inconsistent %s logs without advancing the cursor', async (kind) => {
    const f = fixture(); const feed = f.make(); const before = feed.checkpoint();
    const event = f.event();
    if (kind === 'removed') event.removed = true;
    if (kind === 'hash') event.blockHash = hash(999);
    if (kind === 'range') event.blockNumber = 18n;
    if (kind === 'address') event.address = `0x${'b'.repeat(40)}`;
    f.getContractEvents.mockResolvedValue(kind === 'duplicate' ? [event, event] : [event]);
    await expect(feed.poll()).rejects.toThrow(); expect(feed.checkpoint()).toBe(before);
  });
  it('refuses an unavailable finalized tag without falling back to latest', async () => {
    const f = fixture(); f.getBlock.mockRejectedValue(new Error('finalized unsupported'));
    await expect(f.make().poll()).rejects.toThrow('unsupported'); expect(f.getContractEvents).not.toHaveBeenCalled();
  });
  it('detects a canonical endpoint changing while fetching logs', async () => {
    const f = fixture(); const feed = f.make(); const saved = feed.checkpoint();
    f.getContractEvents.mockImplementationOnce(async () => { const b = f.blocks.get(12n); if (b) f.blocks.set(12n, { ...b, hash: hash(999) }); return [f.event()]; });
    await expect(feed.poll()).rejects.toThrow('changed'); expect(feed.checkpoint()).toBe(saved);
  });
});
