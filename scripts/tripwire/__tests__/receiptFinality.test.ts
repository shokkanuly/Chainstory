import { describe, expect, it, vi } from 'vitest';
import { type Hex } from 'viem';
import { receiptFinality } from '../finality.js';
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex;
const block = { number: 10n, hash: hash(10), parentHash: hash(9), timestamp: 1000n };
function fixture(finalized = 9n) {
  const reader = { getBlock: vi.fn(async (args: { blockTag?: string; blockNumber?: bigint }) => args.blockTag === 'finalized'
    ? { ...block, number: finalized, hash: hash(Number(finalized)) } : block) };
  const receipt = { blockNumber: 10n, blockHash: hash(10) };
  return { reader, receipt };
}
describe('receipt canonical finality', () => {
  it('does not turn block inclusion into finality', async () => {
    const f = fixture(); expect(await receiptFinality(f.reader, f.receipt)).toBe('pending');
  });
  it('requires the receipt block hash to match and its number to be finalized', async () => {
    const f = fixture(12n); expect(await receiptFinality(f.reader, f.receipt)).toBe('finalized'); expect(f.reader.getBlock).toHaveBeenCalledTimes(3);
  });
  it('reports an orphaned inclusion by canonical block hash rather than receipt absence', async () => {
    const f = fixture(); expect(await receiptFinality(f.reader, { ...f.receipt, blockHash: hash(99) })).toBe('orphaned');
  });
  it('catches a canonical block changing while reading the finalized tag', async () => {
    const f = fixture(12n); f.reader.getBlock.mockResolvedValueOnce(block).mockResolvedValueOnce({ ...block, number: 12n }).mockResolvedValueOnce({ ...block, hash: hash(99) });
    expect(await receiptFinality(f.reader, f.receipt)).toBe('orphaned');
  });
  it('rejects a response for the wrong block number', async () => {
    const f = fixture(); f.reader.getBlock.mockResolvedValue({ ...block, number: 11n });
    await expect(receiptFinality(f.reader, f.receipt)).rejects.toThrow('wrong');
  });
  it('refuses a receipt without a block hash', async () => {
    const f = fixture(); await expect(receiptFinality(f.reader, { blockNumber: 10n })).rejects.toThrow(); expect(f.reader.getBlock).not.toHaveBeenCalled();
  });
  it('refuses unsupported finalized tags instead of falling back to latest or a confirmation count', async () => {
    const f = fixture(); f.reader.getBlock.mockResolvedValueOnce(block).mockRejectedValueOnce(new Error('unsupported finalized'));
    await expect(receiptFinality(f.reader, f.receipt)).rejects.toThrow('unsupported');
  });
});
