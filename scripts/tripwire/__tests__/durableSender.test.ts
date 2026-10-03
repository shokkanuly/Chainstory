import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keccak256, parseTransaction, type Hex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { MAX_REPLACEMENTS, OperatorStore, type TransactionRequest } from '../store.js';
import { DurableSender, type TransactionPort } from '../sender.js';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.reverse()) cleanup(); cleanups.length = 0; });
const request: TransactionRequest = { to: actors.bridge.address.toLowerCase(), data: '0x1234', value: '0' };
const raw: Hex = await actors.owner.signTransaction({ chainId: 31337, type: 'eip1559', nonce: 0, gas: 30_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, to: request.to as Hex, data: request.data as Hex, value: 0n });
const hash = keccak256(raw);
function fixture(mode: 'local' | 'finalized' = 'local') {
  const dir = mkdtempSync(join(tmpdir(), 'tripwire-tx-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.sqlite');
  const scope = { route: 'route', chainId: 31337, sourceChainId: 31337, source: actors.owner.address,
    vault: actors.bridge.address, guardian: actors.oracle.address, token: actors.relayer.address, decimals: 6, sender: actors.owner.address, finalityMode: mode };
  const open = () => { const store = new OperatorStore(path, scope); cleanups.push(() => store.close()); return store; };
  const store = open();
  const localPort: TransactionPort = { finalityMode: 'local', chainId: 31337, sender: actors.owner.address,
    prepare: vi.fn().mockResolvedValue(raw), broadcast: vi.fn().mockResolvedValue(hash),
    receipt: vi.fn().mockResolvedValue(null), waitReceipt: vi.fn().mockResolvedValue({ status: 'success', blockNumber: 100n, gasUsed: 21_000n }) };
  const port: TransactionPort = mode === 'local' ? localPort : { ...localPort, finalityMode: 'finalized', finality: vi.fn().mockResolvedValue('finalized'), assertSafe: vi.fn().mockResolvedValue(undefined), onFinalityConflict: vi.fn().mockResolvedValue(undefined) };
  return { store, open, port, sender: new DurableSender(store, port) };
}

describe('durable transaction sender', () => {
  it('refuses unanchored receipts when configured for real-chain finality', async () => {
    const { port, sender, store } = fixture('finalized');
    await expect(sender.send('review', request)).rejects.toThrow('anchor'); expect(store.transaction('review')?.status).toBe('signed');
    expect(port.assertSafe).toHaveBeenCalledTimes(2);
  });
  it('rechecks finalized history and persists a conflict notification before preparing new work', async () => {
    const { port, sender } = fixture('finalized');
    vi.mocked(port.waitReceipt).mockResolvedValue({ status: 'success', blockNumber: 100n, gasUsed: 21_000n, blockHash: keccak256('0xab'), transactionHash: hash });
    await sender.send('review', request); if (!port.finality) throw new Error('Missing fixture finality'); vi.mocked(port.finality).mockResolvedValue('orphaned');
    await expect(sender.send('execute', request)).rejects.toThrow('finalized');
    expect(port.onFinalityConflict).toHaveBeenCalledTimes(1); expect(port.prepare).toHaveBeenCalledTimes(1);
  });

  it('does not reopen a canonical inclusion just because an RPC node omits its receipt', async () => {
    const { port, sender, store } = fixture();
    port.finality = vi.fn().mockResolvedValue('pending');
    vi.mocked(port.waitReceipt).mockResolvedValue({ status: 'success', blockNumber: 100n, gasUsed: 21_000n, blockHash: keccak256('0xab'), transactionHash: hash });
    await sender.send('review', request);
    await expect(sender.recover()).rejects.toThrow('missing'); expect(store.transaction('review')?.status).toBe('included');
    expect(store.transaction('review')?.orphanedReceipts).toBeUndefined(); expect(port.broadcast).toHaveBeenCalledTimes(1);
  });
  it('rejects a receipt for another transaction before saving an outcome', async () => {
    const { port, sender, store } = fixture();
    vi.mocked(port.waitReceipt).mockResolvedValue({ status: 'success', blockNumber: 100n, gasUsed: 21_000n, transactionHash: keccak256('0xab') });
    await expect(sender.send('review', request)).rejects.toThrow('another'); expect(store.transaction('review')?.status).toBe('signed');
  });
  it('keeps an included receipt nonterminal until its canonical block is finalized', async () => {
    const { port, sender, store } = fixture();
    const receipt = { status: 'success' as const, blockNumber: 100n, gasUsed: 21_000n, blockHash: keccak256('0xab'), transactionHash: hash };
    port.finality = vi.fn().mockResolvedValue('pending');
    vi.mocked(port.waitReceipt).mockResolvedValue(receipt);
    expect((await sender.send('review', request)).status).toBe('included');
    expect(store.transaction('review')?.blockHash).toBe(receipt.blockHash);
    vi.mocked(port.receipt).mockResolvedValue(receipt); vi.mocked(port.finality).mockResolvedValue('finalized');
    expect((await sender.recover())[0].status).toBe('confirmed'); expect(port.broadcast).toHaveBeenCalledTimes(1);
  });
  it('replays the original bytes when an unfinalized receipt is orphaned, then finalizes its new inclusion', async () => {
    const { port, sender } = fixture();
    const receipt = { status: 'success' as const, blockNumber: 100n, gasUsed: 21_000n, blockHash: keccak256('0xab'), transactionHash: hash };
    port.finality = vi.fn().mockResolvedValueOnce('pending').mockResolvedValueOnce('orphaned').mockResolvedValue('finalized');
    vi.mocked(port.waitReceipt).mockResolvedValue(receipt);
    expect((await sender.send('review', request)).status).toBe('included');
    vi.mocked(port.waitReceipt).mockResolvedValue({ ...receipt, blockNumber: 101n, blockHash: keccak256('0xcd') });
    expect((await sender.recover())[0].status).toBe('confirmed');
    expect(port.prepare).toHaveBeenCalledTimes(1); expect(port.broadcast).toHaveBeenNthCalledWith(2, raw);
  });
  it('halts on a finalized receipt changing instead of silently accepting or resending it', async () => {
    const { port, sender } = fixture();
    port.finality = vi.fn().mockResolvedValue('finalized');
    vi.mocked(port.waitReceipt).mockResolvedValue({ status: 'success', blockNumber: 100n, gasUsed: 21_000n, blockHash: keccak256('0xab'), transactionHash: hash });
    await sender.send('review', request);
    vi.mocked(port.finality).mockResolvedValue('orphaned');
    await expect(sender.recover()).rejects.toThrow('finalized'); expect(port.broadcast).toHaveBeenCalledTimes(1);
  });
  it('checks chain safety again immediately before broadcast', async () => {
    const { port, sender, store } = fixture();
    port.assertSafe = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('Finality conflict'));
    await expect(sender.send('review', request)).rejects.toThrow('Finality conflict');
    expect(port.broadcast).not.toHaveBeenCalled(); expect(store.transaction('review')?.status).toBe('signed');
  });

  it('commits signed bytes and their hash before any broadcast', async () => {
    const { store, port, sender } = fixture();
    vi.mocked(port.broadcast).mockImplementation(async () => { expect(store.transaction('review')?.hash).toBe(hash); return hash; });
    expect((await sender.send('review', request)).status).toBe('confirmed');
  });
  it('sends nothing when journaling the signed transaction fails', async () => {
    const { store, port, sender } = fixture();
    vi.spyOn(store, 'saveTransaction').mockImplementationOnce(() => { throw new Error('Disk full'); });
    await expect(sender.send('review', request)).rejects.toThrow('Disk full'); expect(port.broadcast).not.toHaveBeenCalled();
  });
  it('resends the same bytes after a crash between persistence and broadcast', async () => {
    const { store, open, port, sender } = fixture();
    vi.mocked(port.broadcast).mockRejectedValueOnce(new Error('lost connection'));
    vi.mocked(port.waitReceipt).mockRejectedValueOnce(new Error('timeout'));
    await expect(sender.send('review', request)).rejects.toThrow('timeout'); store.close();
    expect((await new DurableSender(open(), port).recover())[0].status).toBe('confirmed');
    expect(port.prepare).toHaveBeenCalledTimes(1); expect(port.broadcast).toHaveBeenNthCalledWith(2, raw);
  });
  it('reconciles a mined transaction after receipt persistence failed without rebroadcasting', async () => {
    const { store, open, port, sender } = fixture(); const save = store.saveTransaction.bind(store);
    vi.spyOn(store, 'saveTransaction').mockImplementation((state) => { if (state.status !== 'signed') throw new Error('Disk full'); save(state); });
    await expect(sender.send('review', request)).rejects.toThrow('Disk full'); store.close();
    vi.mocked(port.receipt).mockResolvedValue({ status: 'success', blockNumber: 100n, gasUsed: 21_000n });
    expect((await new DurableSender(open(), port).recover())[0].status).toBe('confirmed'); expect(port.broadcast).toHaveBeenCalledTimes(1);
  });
  it('reconciles broadcast errors such as already-known from the receipt', async () => {
    const { port, sender } = fixture(); vi.mocked(port.broadcast).mockRejectedValue(new Error('already known'));
    expect((await sender.send('review', request)).status).toBe('confirmed');
  });
  it('keeps receipt timeouts outstanding and forbids new nonce allocation until recovery', async () => {
    const { port, sender } = fixture(); vi.mocked(port.waitReceipt).mockRejectedValue(new Error('timeout'));
    await expect(sender.send('review', request)).rejects.toThrow('timeout');
    await expect(sender.send('execute', request)).rejects.toThrow('outstanding'); expect(port.prepare).toHaveBeenCalledTimes(1);
  });
  it('records a revert as terminal and does not automatically create or resend another transaction', async () => {
    const { port, sender } = fixture(); vi.mocked(port.waitReceipt).mockResolvedValue({ status: 'reverted', blockNumber: 100n, gasUsed: 25_000n });
    expect((await sender.send('review', request)).status).toBe('reverted');
    expect((await sender.send('review', request)).status).toBe('reverted'); expect(port.broadcast).toHaveBeenCalledTimes(1);
  });
  it('rejects operation id reuse with changed transaction contents', async () => {
    const { sender } = fixture(); await sender.send('review', request);
    await expect(sender.send('review', { ...request, value: '1' })).rejects.toThrow('contents');
  });
  it('rejects wrong sender/chain scope before any signing', () => {
    const { store, port } = fixture(); expect(() => new DurableSender(store, { ...port, chainId: 1 })).toThrow('scope');
  });
  it('rejects signed bytes for a different payload before journaling or broadcasting', async () => {
    const { store, port, sender } = fixture();
    await expect(sender.send('review', { ...request, data: '0xabcd' })).rejects.toThrow('does not match');
    expect(store.transactions()).toEqual([]); expect(port.broadcast).not.toHaveBeenCalled();
  });
  it('refuses a corrupted journal hash during recovery without broadcasting', async () => {
    const { store, port, sender } = fixture();
    store.saveTransaction({ id: 'review', request, raw, hash: `0x${'0'.repeat(64)}`, status: 'signed' });
    await expect(sender.recover()).rejects.toThrow('does not match'); expect(port.broadcast).not.toHaveBeenCalled();
  });
});

/** The same nonce, gas and call, re-signed with both fees multiplied. */
async function resign(previous: Hex, multiply: (fee: bigint) => bigint, change: Partial<{ nonce: number; data: Hex }> = {}): Promise<Hex> {
  const tx = parseTransaction(previous);
  if (tx.type !== 'eip1559' || tx.nonce === undefined) throw new Error('fixture expects EIP-1559');
  return actors.owner.signTransaction({ chainId: 31337, type: 'eip1559', nonce: change.nonce ?? tx.nonce, gas: tx.gas,
    maxFeePerGas: multiply(tx.maxFeePerGas ?? 0n), maxPriorityFeePerGas: multiply(tx.maxPriorityFeePerGas ?? 0n),
    to: tx.to, data: change.data ?? tx.data, value: tx.value ?? 0n });
}

describe('fee-bumped replacement', () => {
  const mined = (transactionHash: Hex) => ({ status: 'success' as const, blockNumber: 100n, gasUsed: 21_000n, transactionHash });
  function stuck(mode: 'local' | 'finalized' = 'local') {
    const f = fixture(mode);
    vi.mocked(f.port.waitReceipt).mockRejectedValue(new Error('WaitForTransactionReceiptTimeoutError'));
    f.port.replace = vi.fn((previous: Hex) => resign(previous, (fee) => fee * 2n));
    return f;
  }

  it('journals a re-signed copy with higher fees before broadcasting it, then accepts its receipt', async () => {
    const { store, port, sender } = stuck();
    vi.mocked(port.broadcast).mockImplementation(async (bytes) => {
      // Write-ahead: whatever is broadcast is already in the journal.
      const journaled = store.transaction('review');
      expect([journaled?.raw, ...(journaled?.replacements ?? []).map((r) => r.raw)]).toContain(bytes); return keccak256(bytes);
    });
    await expect(sender.send('review', request)).rejects.toThrow('fee-bumped');
    const bumped = store.transaction('review')?.replacements?.[0];
    if (!bumped) throw new Error('no replacement journaled');
    expect(parseTransaction(bumped.raw as Hex)).toMatchObject({ nonce: 0, maxFeePerGas: 2n, maxPriorityFeePerGas: 2n, data: request.data });
    expect(port.broadcast).toHaveBeenLastCalledWith(bumped.raw);
    // The next recovery waits for the newest version and records which one was mined.
    vi.mocked(port.waitReceipt).mockResolvedValue(mined(bumped.hash as Hex));
    expect(await sender.recover()).toMatchObject([{ status: 'confirmed', minedHash: bumped.hash }]);
    expect(port.prepare).toHaveBeenCalledTimes(1);
  });
  it('accepts a receipt for an earlier version that was mined while it waited on a newer one', async () => {
    const { store, port, sender } = stuck();
    await expect(sender.send('review', request)).rejects.toThrow('fee-bumped');
    vi.mocked(port.receipt).mockImplementation(async (h) => h === hash ? mined(hash) : null);
    const [settled] = await sender.recover();
    expect(settled).toMatchObject({ status: 'confirmed' }); expect(settled.minedHash).toBeUndefined();
    expect(store.transaction('review')?.replacements).toHaveLength(1);
  });
  it('bumps at once when a node refuses the transaction as underpriced, without waiting', async () => {
    const { store, port, sender } = stuck();
    vi.mocked(port.broadcast).mockRejectedValueOnce(new Error('replacement transaction underpriced'));
    await expect(sender.send('review', request)).rejects.toThrow('fee-bumped');
    expect(port.waitReceipt).not.toHaveBeenCalled(); expect(store.transaction('review')?.replacements).toHaveLength(1);
  });
  it('surfaces an unfunded relayer instead of waiting on a broadcast that never happened', async () => {
    const { store, port, sender } = stuck();
    vi.mocked(port.broadcast).mockRejectedValue(Object.assign(new Error('RPC error'), { cause: new Error('insufficient funds for gas * price + value') }));
    await expect(sender.send('review', request)).rejects.toThrow('cannot pay');
    expect(port.waitReceipt).not.toHaveBeenCalled(); expect(store.transaction('review')?.status).toBe('signed');
  });
  it.each([
    ['a fee raise under 10%', (p: Hex) => resign(p, (fee) => fee)],
    ['another nonce', (p: Hex) => resign(p, (fee) => fee * 2n, { nonce: 7 })],
    ['another call', (p: Hex) => resign(p, (fee) => fee * 2n, { data: '0xabcd' })],
  ])('refuses a replacement with %s before journaling or broadcasting it', async (_name, replace) => {
    const { store, port, sender } = stuck(); port.replace = vi.fn(replace);
    await expect(sender.send('review', request)).rejects.toThrow(/does not match|10%/);
    expect(store.transaction('review')?.replacements).toBeUndefined(); expect(port.broadcast).toHaveBeenCalledTimes(1);
  });
  it(`stops bumping after ${MAX_REPLACEMENTS} replacements and says so`, async () => {
    const { store, sender } = stuck();
    await expect(sender.send('review', request)).rejects.toThrow('fee-bumped');
    for (let i = 1; i < MAX_REPLACEMENTS; i++) await expect(sender.recover()).rejects.toThrow('fee-bumped');
    await expect(sender.recover()).rejects.toThrow(`after ${MAX_REPLACEMENTS} fee bumps`);
    expect(store.transaction('review')?.replacements).toHaveLength(MAX_REPLACEMENTS);
  });
  it('halts when an RPC claims two versions of one nonce were both mined', async () => {
    const { port, sender } = stuck();
    await expect(sender.send('review', request)).rejects.toThrow('fee-bumped');
    vi.mocked(port.receipt).mockImplementation(async (h) => mined(h));
    await expect(sender.recover()).rejects.toThrow('two versions');
  });
  it('keeps journaled replacements append-only, and only while nothing is mined', async () => {
    const { store, sender } = stuck();
    await expect(sender.send('review', request)).rejects.toThrow('fee-bumped');
    const state = store.transaction('review'); const replacements = state?.replacements;
    if (!state || !replacements) throw new Error('no replacement journaled');
    expect(() => store.saveTransaction({ ...state, replacements: [] })).toThrow('append-only');
    const raw = await resign(replacements[0].raw as Hex, (fee) => fee * 2n);
    const included = { ...state, status: 'included' as const, receiptStatus: 'success' as const, block: '100', gas: '21000', blockHash: keccak256('0xab') };
    store.saveTransaction(included);
    expect(() => store.saveTransaction({ ...included, replacements: [...replacements, { raw, hash: keccak256(raw) }] })).toThrow('no known inclusion');
  });
  it('replays the newest version after its unfinalized inclusion is orphaned', async () => {
    const { store, port, sender } = stuck();
    await expect(sender.send('review', request)).rejects.toThrow('fee-bumped');
    const bumped = store.transaction('review')?.replacements?.[0];
    if (!bumped) throw new Error('no replacement journaled');
    port.finality = vi.fn().mockResolvedValueOnce('pending').mockResolvedValueOnce('orphaned').mockResolvedValue('finalized');
    vi.mocked(port.waitReceipt).mockResolvedValue({ ...mined(bumped.hash as Hex), blockHash: keccak256('0xab') });
    expect((await sender.recover())[0]).toMatchObject({ status: 'included', minedHash: bumped.hash });
    vi.mocked(port.waitReceipt).mockResolvedValue({ ...mined(bumped.hash as Hex), blockNumber: 101n, blockHash: keccak256('0xcd') });
    expect((await sender.recover())[0]).toMatchObject({ status: 'confirmed', minedHash: bumped.hash, block: '101' });
    expect(store.transaction('review')?.orphanedReceipts).toMatchObject([{ block: '100', minedHash: bumped.hash }]);
    expect(port.broadcast).toHaveBeenLastCalledWith(bumped.raw);
  });
});
