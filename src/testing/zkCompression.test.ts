import { describe, it, expect } from 'vitest';
import { normalizeSolanaTx, type SolanaRpcTransaction } from '../chains/solana/normalize/balanceDiff';
import { calculateFifoTaxReport } from '../services/fifoEngine';
import { isLightProgram } from '../chains/solana/registry/light';
import { NormalizedTxSchema, WELL_KNOWN_CHAINS } from '../domain';
import type { ClassifiedTransaction } from '../types';

describe('ZK Compression Normalization & Invariants (Phase 2)', () => {
  const SUBJECT = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  it('identifies official Light Protocol ZK compression programs', () => {
    expect(isLightProgram('SysProgram1111111111111111111111111111111111')).toBe(true);
    expect(isLightProgram('cTokenmWWQr26tuStAepFuknRht84P8U8861j7vK6vM')).toBe(true);
    expect(isLightProgram('cmtDvXumGCrqC1Age74AVPhYWVXJMd8PJSKezK52rk5')).toBe(true);
    expect(isLightProgram('11111111111111111111111111111111')).toBe(false);
  });

  it('normalizes a SOL Compress operation (standard out, compressed in)', () => {
    const rawCompressTx: SolanaRpcTransaction = {
      slot: 280005000,
      blockTime: 1772545000,
      transaction: {
        signatures: ['4cmp...compressSolTxSig'],
        message: {
          accountKeys: [
            SUBJECT, // fee payer
            'SysProgram1111111111111111111111111111111111',
          ],
          instructions: [
            {
              programId: 'SysProgram1111111111111111111111111111111111',
            },
          ],
        },
      },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [2000000000, 1], // 2 SOL
        postBalances: [999995000, 1], // 1 SOL left (-1 SOL standard delta)
      },
      compressionInfo: {
        opened_accounts: [
          {
            hash: 'leafHash123',
            owner: SUBJECT,
            lamports: 1000000000, // +1 SOL compressed delta
          },
        ],
        closed_accounts: [],
      },
    };

    const normalized = normalizeSolanaTx(rawCompressTx, SUBJECT, WELL_KNOWN_CHAINS.SOLANA_MAINNET);

    expect(() => NormalizedTxSchema.parse(normalized)).not.toThrow();
    expect(normalized.tags).toContain('compressed_state');
    expect(normalized.tags).toContain('compression:compress');

    expect(normalized.movements).toHaveLength(1);
    expect(normalized.movements[0].role).toBe('compress');
    expect(normalized.movements[0].state).toBe('compressed');
    expect(normalized.movements[0].amount).toBe(1000000000n);

    expect(normalized.interactions[0].protocol).toBe('light-protocol');
    expect(normalized.interactions[0].method).toBe('Light System Program');
  });

  it('normalizes a SOL Decompress operation (compressed out, standard in)', () => {
    const rawDecompressTx: SolanaRpcTransaction = {
      slot: 280006000,
      blockTime: 1772546000,
      transaction: {
        signatures: ['2dec...decompressSolTxSig'],
        message: {
          accountKeys: [
            SUBJECT,
            'SysProgram1111111111111111111111111111111111',
          ],
          instructions: [
            {
              programId: 'SysProgram1111111111111111111111111111111111',
            },
          ],
        },
      },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [1000000000, 1],
        postBalances: [1999995000, 1], // +1 SOL standard delta
      },
      compressionInfo: {
        opened_accounts: [],
        closed_accounts: [
          {
            hash: 'leafHash123',
            owner: SUBJECT,
            lamports: 1000000000, // -1 SOL compressed delta
          },
        ],
      },
    };

    const normalized = normalizeSolanaTx(rawDecompressTx, SUBJECT, WELL_KNOWN_CHAINS.SOLANA_MAINNET);

    expect(() => NormalizedTxSchema.parse(normalized)).not.toThrow();
    expect(normalized.tags).toContain('compressed_state');
    expect(normalized.tags).toContain('compression:decompress');

    expect(normalized.movements).toHaveLength(1);
    expect(normalized.movements[0].role).toBe('decompress');
    expect(normalized.movements[0].state).toBe('standard');
    expect(normalized.movements[0].amount).toBe(1000000000n);
  });

  it('normalizes a compressed SPL Token transfer', () => {
    const rawCmpTokenTx: SolanaRpcTransaction = {
      slot: 280007000,
      blockTime: 1772547000,
      transaction: {
        signatures: ['1ctk...transferCompressedTokenSig'],
        message: {
          accountKeys: [
            SUBJECT,
            'cTokenmWWQr26tuStAepFuknRht84P8U8861j7vK6vM',
          ],
          instructions: [
            {
              programId: 'cTokenmWWQr26tuStAepFuknRht84P8U8861j7vK6vM',
            },
          ],
        },
      },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [1000000000, 1],
        postBalances: [999995000, 1],
        preTokenBalances: [],
        postTokenBalances: [],
      },
      compressionInfo: {
        opened_accounts: [],
        closed_accounts: [
          {
            hash: 'tokenLeaf456',
            owner: SUBJECT,
            tokenData: {
              mint: USDC_MINT,
              owner: SUBJECT,
              amount: '100000000', // 100 USDC sent
            },
          },
        ],
      },
    };

    const normalized = normalizeSolanaTx(rawCmpTokenTx, SUBJECT, WELL_KNOWN_CHAINS.SOLANA_MAINNET);

    expect(normalized.tags).toContain('compressed_state');
    expect(normalized.tags).toContain('compression:transfer');
    expect(normalized.movements).toHaveLength(1);
    expect(normalized.movements[0].direction).toBe('out');
    expect(normalized.movements[0].state).toBe('compressed');
    expect(normalized.movements[0].amount).toBe(100000000n);
    expect(normalized.movements[0].asset.address).toBe(USDC_MINT);
  });

  it('proves Invariant I7: compress followed by decompress does not generate taxable capital gains', () => {
    // 1. Initial acquisition of 1 SOL @ $180
    // 2. Compress 1 SOL to ZK compressed state
    // 3. Decompress 1 SOL back to standard state
    const txs: ClassifiedTransaction[] = [
      {
        hash: 'tx_acquire',
        blockNumber: '280001000',
        from: '4Nd1mBQtrMJVYVfKf2PJy9NZ2rBlQy2SZVHNxnLkK2s3',
        to: SUBJECT,
        description: 'Received 1.0 SOL transfer',
        category: 'transfer',
        confidence: 0.99,
        usdValue: 180,
        ethValue: 1.0,
        status: 'classified',
        value: '1000000000',
        gas: '5000',
        gasUsed: '5000',
        gasPrice: '1',
        input: '0x',
        isError: '0',
        txreceipt_status: '1',
        timeStamp: '1772000000',
        date: new Date('2026-02-24T10:00:00Z'),
        walletLabel: SUBJECT,
        tokenSymbol: 'SOL',
      },
      {
        hash: 'tx_compress',
        blockNumber: '280005000',
        from: SUBJECT,
        to: 'SysProgram1111111111111111111111111111111111',
        description: 'Compressed 1.0 SOL into ZK-compressed state',
        category: 'transfer',
        confidence: 0.99,
        usdValue: 190, // Market price changed, but compression is NOT a disposal!
        ethValue: 1.0,
        status: 'classified',
        value: '1000000000',
        gas: '5000',
        gasUsed: '5000',
        gasPrice: '1',
        input: '0x',
        isError: '0',
        txreceipt_status: '1',
        timeStamp: '1772100000',
        date: new Date('2026-02-25T10:00:00Z'),
        walletLabel: SUBJECT,
        tokenSymbol: 'SOL',
      },
      {
        hash: 'tx_decompress',
        blockNumber: '280006000',
        from: 'SysProgram1111111111111111111111111111111111',
        to: SUBJECT,
        description: 'Decompressed 1.0 SOL back into standard account',
        category: 'transfer',
        confidence: 0.99,
        usdValue: 200,
        ethValue: 1.0,
        status: 'classified',
        value: '1000000000',
        gas: '5000',
        gasUsed: '5000',
        gasPrice: '1',
        input: '0x',
        isError: '0',
        txreceipt_status: '1',
        timeStamp: '1772200000',
        date: new Date('2026-02-26T10:00:00Z'),
        walletLabel: SUBJECT,
        tokenSymbol: 'SOL',
      },
    ];

    const report = calculateFifoTaxReport(txs, SUBJECT);

    // Assert that zero taxable disposals occurred and zero phantom capital gains were realized
    expect(report.realizedTransactions).toHaveLength(0);
    expect(report.totalProceedsUsd).toBe(0);
    expect(report.totalCostBasisUsd).toBe(0);
    expect(report.totalRealizedGainUsd).toBe(0);
    // The original acquisition lot of 1.0 SOL remains open and unconsumed
    expect(report.remainingOpenLots).toHaveLength(1);
    expect(report.remainingOpenLots[0].amount).toBe(1.0);
    expect(report.remainingOpenLots[0].remainingAmount).toBe(1.0);
  });

  it('normalizes generated ZK compression fixtures directly from filesystem', async () => {
    const compressRaw = await import('./fixtures/zk/compress_sol.json');
    const normalizedCompress = normalizeSolanaTx(compressRaw.default, SUBJECT, WELL_KNOWN_CHAINS.SOLANA_MAINNET);
    expect(normalizedCompress.tags).toContain('compression:compress');
    expect(normalizedCompress.movements[0].role).toBe('compress');

    const decompressRaw = await import('./fixtures/zk/decompress_sol.json');
    const normalizedDecompress = normalizeSolanaTx(decompressRaw.default, SUBJECT, WELL_KNOWN_CHAINS.SOLANA_MAINNET);
    expect(normalizedDecompress.tags).toContain('compression:decompress');
    expect(normalizedDecompress.movements[0].role).toBe('decompress');

    const transferRaw = await import('./fixtures/zk/compressed_transfer.json');
    const normalizedTransfer = normalizeSolanaTx(transferRaw.default, SUBJECT, WELL_KNOWN_CHAINS.SOLANA_MAINNET);
    expect(normalizedTransfer.tags).toContain('compression:transfer');
    expect(normalizedTransfer.movements[0].state).toBe('compressed');
  });
});
