import { describe, it, expect } from 'vitest';
import { defaultRegistry } from '../chains';
import { normalizeSolanaTx, type SolanaRpcTransaction } from '../chains/solana/normalize/balanceDiff';
import { NormalizedTxSchema, WELL_KNOWN_CHAINS } from '../domain';

describe('Solana Adapter & Balance-Diff Normalization', () => {
  const SUBJECT_WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  const COUNTERPARTY_WALLET = '4Nd1mBQtrMJVYVfKf2PJy9NZ2rBlQy2SZVHNxnLkK2s3';
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  it('routes Base58 address to the SVM adapter', () => {
    const adapter = defaultRegistry.resolveAdapterForInput(SUBJECT_WALLET);
    expect(adapter).toBeDefined();
    expect(adapter?.family).toBe('svm');
  });

  it('normalizes native SOL transfer using balance-diff', () => {
    const rawTx: SolanaRpcTransaction = {
      slot: 280000000,
      blockTime: 1772539200,
      transaction: {
        signatures: ['5wHu...sampleSolTransferSig'],
        message: {
          accountKeys: [
            COUNTERPARTY_WALLET, // fee payer
            SUBJECT_WALLET,
            '11111111111111111111111111111111',
          ],
          instructions: [
            {
              programId: '11111111111111111111111111111111',
            },
          ],
        },
      },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [1000000000, 500000000, 1], // subject had 0.5 SOL
        postBalances: [799995000, 700000000, 1], // subject received 0.2 SOL (200_000_000 lamports)
      },
    };

    const normalized = normalizeSolanaTx(rawTx, SUBJECT_WALLET, WELL_KNOWN_CHAINS.SOLANA_MAINNET);

    expect(() => NormalizedTxSchema.parse(normalized)).not.toThrow();
    expect(normalized.status).toBe('success');
    expect(normalized.movements).toHaveLength(1);
    expect(normalized.movements[0].direction).toBe('in');
    expect(normalized.movements[0].amount).toBe(200000000n);
    expect(normalized.movements[0].asset.symbol).toBe('SOL');
    expect(normalized.interactions[0].protocol).toBe('system');
  });

  it('normalizes SPL token transfer using pre/post token balances', () => {
    const rawTx: SolanaRpcTransaction = {
      slot: 280001000,
      blockTime: 1772540000,
      transaction: {
        signatures: ['4xTz...sampleSplTransferSig'],
        message: {
          accountKeys: [
            SUBJECT_WALLET, // fee payer
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          ],
          instructions: [
            {
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            },
          ],
        },
      },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [1000000000, 1],
        postBalances: [999995000, 1],
        preTokenBalances: [
          {
            accountIndex: 0,
            mint: USDC_MINT,
            owner: SUBJECT_WALLET,
            uiTokenAmount: {
              amount: '1000000000', // 1,000 USDC
              decimals: 6,
            },
          },
        ],
        postTokenBalances: [
          {
            accountIndex: 0,
            mint: USDC_MINT,
            owner: SUBJECT_WALLET,
            uiTokenAmount: {
              amount: '800000000', // 800 USDC (sent 200 USDC)
              decimals: 6,
            },
          },
        ],
      },
    };

    const normalized = normalizeSolanaTx(rawTx, SUBJECT_WALLET, WELL_KNOWN_CHAINS.SOLANA_MAINNET);

    expect(() => NormalizedTxSchema.parse(normalized)).not.toThrow();
    expect(normalized.movements).toHaveLength(1);
    expect(normalized.movements[0].direction).toBe('out');
    expect(normalized.movements[0].amount).toBe(200000000n); // 200 USDC
    expect(normalized.movements[0].asset.address).toBe(USDC_MINT);
    expect(normalized.interactions[0].protocol).toBe('spl-token');
  });

  it('identifies DEX swap legs and protocol on Jupiter swaps', () => {
    const rawTx: SolanaRpcTransaction = {
      slot: 280002000,
      blockTime: 1772541000,
      transaction: {
        signatures: ['3aBc...sampleJupiterSwapSig'],
        message: {
          accountKeys: [
            SUBJECT_WALLET,
            'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
          ],
          instructions: [
            {
              programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
            },
          ],
        },
      },
      meta: {
        err: null,
        fee: 10000,
        preBalances: [2000000000, 1], // 2 SOL
        postBalances: [999990000, 1], // 1 SOL (sold 1 SOL)
        preTokenBalances: [
          {
            accountIndex: 0,
            mint: USDC_MINT,
            owner: SUBJECT_WALLET,
            uiTokenAmount: {
              amount: '0',
              decimals: 6,
            },
          },
        ],
        postTokenBalances: [
          {
            accountIndex: 0,
            mint: USDC_MINT,
            owner: SUBJECT_WALLET,
            uiTokenAmount: {
              amount: '180000000', // 180 USDC received
              decimals: 6,
            },
          },
        ],
      },
    };

    const normalized = normalizeSolanaTx(rawTx, SUBJECT_WALLET, WELL_KNOWN_CHAINS.SOLANA_MAINNET);

    expect(normalized.movements).toHaveLength(2);
    // 1 SOL out
    const outLeg = normalized.movements.find((m) => m.direction === 'out');
    expect(outLeg).toBeDefined();
    expect(outLeg?.role).toBe('swap_leg');
    expect(outLeg?.amount).toBe(1000000000n);

    // 180 USDC in
    const inLeg = normalized.movements.find((m) => m.direction === 'in');
    expect(inLeg).toBeDefined();
    expect(inLeg?.role).toBe('swap_leg');
    expect(inLeg?.amount).toBe(180000000n);

    // Jupiter interaction detected
    const jupInteraction = normalized.interactions.find((i) => i.protocol === 'jupiter');
    expect(jupInteraction).toBeDefined();
    expect(jupInteraction?.method).toBe('Jupiter v6 Routing');
  });

  it('resolves valid Solana address and rejects invalid inputs', async () => {
    const adapter = defaultRegistry.resolveAdapterForInput(SUBJECT_WALLET);
    expect(adapter).toBeDefined();

    const resolved = await adapter?.resolve?.(SUBJECT_WALLET);
    expect(resolved?.ok).toBe(true);
    if (resolved?.ok) {
      expect(resolved.value.address).toBe(SUBJECT_WALLET);
      expect(resolved.value.chain).toBe(WELL_KNOWN_CHAINS.SOLANA_MAINNET);
    }

    const invalid = await adapter?.resolve?.('invalid-not-base58');
    expect(invalid?.ok).toBe(false);
  });

  it('audits SPL token permissions gracefully with fallback on network error', async () => {
    const adapter = defaultRegistry.resolveAdapterForInput(SUBJECT_WALLET);
    expect(adapter).toBeDefined();

    const auditResult = await adapter?.auditPermissions(SUBJECT_WALLET, {
      rpcUrl: 'https://invalid-rpc-domain-testing.test',
    });
    expect(auditResult?.ok).toBe(true);
    if (auditResult?.ok) {
      expect(Array.isArray(auditResult.value)).toBe(true);
    }
  });

  it('scans contract upgrade authority gracefully', async () => {
    const adapter = defaultRegistry.resolveAdapterForInput(SUBJECT_WALLET);
    expect(adapter).toBeDefined();

    const scanResult = await adapter?.scanContract('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', {
      rpcUrl: 'https://invalid-rpc-domain-testing.test',
    });
    expect(scanResult?.ok).toBe(true);
    if (scanResult?.ok) {
      expect(scanResult.value.isContract).toBe(true);
      expect(scanResult.value.riskLevel).toBe('low');
    }
  });
});

