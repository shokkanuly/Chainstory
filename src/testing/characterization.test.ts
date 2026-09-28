// src/testing/characterization.test.ts
import { describe, it, expect } from 'vitest';
import { runKnownWalletValidation, generateCsvFromReport, KNOWN_WALLET_FIXTURES, KNOWN_PUBLIC_WALLET } from '../services/knownWalletValidation';
import { calculateFifoTaxReport } from '../services/fifoEngine';
import { generateFallbackDescription } from '../services/descriptionGenerator';
import type { ClassifiedTransaction } from '../types';

describe('Characterization Baseline Tests (EVM v1)', () => {
  it('passes the known wallet validation suite', () => {
    const res = runKnownWalletValidation();
    expect(res.success).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.summary.totalTxs).toBe(3);
    expect(res.summary.storyCategoryCounts.trade).toBe(1);
    expect(res.summary.storyCategoryCounts.income).toBe(1);
    expect(res.summary.storyCategoryCounts.transfer).toBe(1);
    expect(res.summary.totalProceedsUsd).toBe(4000);
    expect(res.summary.totalCostBasisUsd).toBe(4000);
    expect(res.summary.netGainLossUsd).toBeCloseTo(-9.39, 2);
    expect(res.summary.csvLineCount).toBe(2);
  });

  it('generates consistent deterministic story narratives', () => {
    const classified: ClassifiedTransaction[] = KNOWN_WALLET_FIXTURES.map((tx) => {
      const ethValue = parseFloat(tx.value) / 1e18;
      const isIncoming = tx.from.toLowerCase() !== KNOWN_PUBLIC_WALLET.toLowerCase();
      
      let category: ClassifiedTransaction['category'] = 'transfer';
      if (tx.input.startsWith('0x4e71d92d')) {
        category = 'income';
      } else if (tx.input.startsWith('0x7ff36ab5')) {
        category = 'trade';
      } else if (isIncoming) {
        category = 'transfer';
      }

      const description = generateFallbackDescription(tx, category, ethValue);
      return {
        ...tx,
        description,
        category,
        confidence: 0.95,
        usdValue: ethValue * 2000,
        ethValue,
        status: 'classified',
        date: new Date(parseInt(tx.timeStamp) * 1000),
      };
    });

    expect(classified[0].description).toBe('simple_transfer — 5.0000 ETH');
    expect(classified[1].description).toBe('staking_claim — 0.2000 ETH');
    expect(classified[2].description).toBe('uniswap_swap_eth_for_tokens — 2.0000 ETH');
  });

  it('generates expected CSV golden headers and row format', () => {
    const classified: ClassifiedTransaction[] = KNOWN_WALLET_FIXTURES.map((tx) => {
      const ethValue = parseFloat(tx.value) / 1e18;
      let category: ClassifiedTransaction['category'] = 'transfer';
      if (tx.input.startsWith('0x4e71d92d')) category = 'income';
      else if (tx.input.startsWith('0x7ff36ab5')) category = 'trade';

      return {
        ...tx,
        description: '',
        category,
        confidence: 0.95,
        usdValue: ethValue * 2000,
        ethValue,
        status: 'classified',
        date: new Date(parseInt(tx.timeStamp) * 1000),
      };
    });

    const report = calculateFifoTaxReport(classified, KNOWN_PUBLIC_WALLET);
    const csv = generateCsvFromReport(report);
    const lines = csv.trim().split('\n');

    expect(lines[0]).toBe('Tx Hash,Asset,Date Disposed,Amount Disposed,Proceeds (USD),Cost Basis (USD),Gain / Loss (USD),Holding Period');
    expect(lines[1]).toContain('0x1000000000000000000000000000000000000000000000000000000000000003,ETH,2023-07-23,2.000000,4000.00,4000.00,0.00,Short Term (<=1yr)');
  });
});
