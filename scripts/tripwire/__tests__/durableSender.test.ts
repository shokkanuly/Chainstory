import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keccak256, type Hex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { OperatorStore, type TransactionRequest } from '../store.js';
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
