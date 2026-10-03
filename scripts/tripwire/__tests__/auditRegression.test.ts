// Audit regression, off-chain half (HIGH-1; the audit's PoC "HIGH-5", inverted).
// Before: one underpriced review blocked every later transaction, FREEZE
// included, and recovery rebroadcast the same bytes forever. The contract
// half lives in contracts/evm/test/auditRegression.evm.test.ts.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keccak256, parseTransaction, type Hex, type LocalAccount } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { OperatorStore, type TransactionRequest } from '../store.js';
import { DurableSender, type TransactionPort } from '../sender.js';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

/** A chain where a transaction mines only if its fee cap reaches the base fee: an exploit's gas spike. */
function lane(account: LocalAccount, path: string, baseFee: bigint, startFee: bigint) {
  const store = new OperatorStore(path, { route: 'r', chainId: 31337, sourceChainId: 31337, source: actors.owner.address,
    vault: actors.bridge.address, guardian: actors.oracle.address, token: actors.bridge.address, decimals: 6, sender: account.address, finalityMode: 'local' });
  cleanups.push(() => store.close());
  const mined = new Set<Hex>(); let nonce = 0;
  const sign = (r: { to: Hex; data: Hex }, n: number, fee: bigint) => account.signTransaction({ chainId: 31337, type: 'eip1559', nonce: n,
    gas: 50_000n, maxFeePerGas: fee, maxPriorityFeePerGas: fee, to: r.to, data: r.data, value: 0n });
  const port: TransactionPort = { finalityMode: 'local', chainId: 31337, sender: account.address,
    prepare: vi.fn((r: TransactionRequest) => sign({ to: r.to as Hex, data: r.data as Hex }, nonce++, startFee)),
    replace: vi.fn(async (previous: Hex) => {
      const tx = parseTransaction(previous);
      if (!tx.to || tx.nonce === undefined || tx.maxFeePerGas === undefined) throw new Error('fixture');
      return sign({ to: tx.to, data: tx.data ?? '0x' }, tx.nonce, tx.maxFeePerGas * 2n);
    }),
    broadcast: vi.fn(async (raw: Hex) => {
      if ((parseTransaction(raw).maxFeePerGas ?? 0n) >= baseFee) mined.add(keccak256(raw));
      return keccak256(raw);
    }),
    receipt: vi.fn(async (hash: Hex) => mined.has(hash) ? { status: 'success' as const, blockNumber: 100n, gasUsed: 21_000n, transactionHash: hash } : null),
    waitReceipt: vi.fn(async (hash: Hex) => {
      if (!mined.has(hash)) throw new Error('WaitForTransactionReceiptTimeoutError: 60s');
      return { status: 'success' as const, blockNumber: 100n, gasUsed: 21_000n, transactionHash: hash };
    }) };
  return { store, port, sender: new DurableSender(store, port) };
}

describe('AUDIT regression HIGH-1: a stuck review cannot hold back a FREEZE', () => {
  it('sends the FREEZE from its own lane at once, and fee-bumps the stuck review until it mines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tw-audit-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    // Reviews pay from one relayer, attestations from another (ADR-026).
    const releases = lane(actors.owner, join(dir, 'release.sqlite'), 30n, 1n);
    const attestations = lane(actors.relayer, join(dir, 'release.attestations.sqlite'), 30n, 40n);
    const review: TransactionRequest = { to: actors.bridge.address.toLowerCase(), data: '0x1234', value: '0' };
    const freeze: TransactionRequest = { to: actors.oracle.address.toLowerCase(), data: '0xabcd', value: '0' };

    await expect(releases.sender.send('review/0x01/1', review)).rejects.toThrow('fee-bumped');
    // Within a lane one nonce at a time still holds; that is why the lanes are split.
    await expect(releases.sender.send('execute/0x01/1', review)).rejects.toThrow('Recover the outstanding transaction');
    // The urgent FREEZE is not behind it.
    expect((await attestations.sender.send('attestation/42', freeze)).status).toBe('confirmed');

    // Each recovery journals a re-signed copy with higher fees: 1 → 2 → … → 32 wei clears the 30 wei base fee.
    let settled = null;
    for (let attempt = 0; attempt < 8 && !settled; attempt++) {
      try { settled = (await releases.sender.recover())[0]; } catch (error) { expect(String(error)).toContain('fee-bumped'); }
    }
    expect(settled).toMatchObject({ id: 'review/0x01/1', status: 'confirmed' });
    const journaled = releases.store.transaction('review/0x01/1');
    expect(journaled?.replacements).toHaveLength(5); expect(journaled?.minedHash).toBe(journaled?.replacements?.at(-1)?.hash);
    // Not the same bytes over and over: every broadcast after the first is a new, journaled version.
    expect(new Set(vi.mocked(releases.port.broadcast).mock.calls.map((call) => call[0])).size).toBe(6);
    expect(releases.port.prepare).toHaveBeenCalledTimes(1);
    expect(new Set([journaled?.raw, ...(journaled?.replacements ?? []).map((r) => r.raw)].map((raw) => parseTransaction(raw as Hex).nonce))).toEqual(new Set([0]));
  });
});
