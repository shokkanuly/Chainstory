// src/services/knownWallet.test.ts
//
// End-to-end assertion over a fixed three-transaction wallet: the story
// narrative, the FIFO report, and the Form 8949 CSV export.
//
// This was previously a bare script that threw on failure. It is now a real
// Vitest suite so `npm test` and CI cover it.

import { describe, expect, it } from 'vitest';
import { runKnownWalletValidation } from './knownWalletValidation';

describe('known public wallet end-to-end validation', () => {
  const result = runKnownWalletValidation();

  it('passes every assertion', () => {
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('classifies the fixture into one trade, one income and one transfer', () => {
    expect(result.summary.storyCategoryCounts).toMatchObject({
      trade: 1,
      income: 1,
      transfer: 1,
    });
  });

  it('reports a cost basis for the swap disposal rather than zero', () => {
    // The regression this fixture originally caught: proceeds were recorded
    // while cost basis came out as $0, overstating the taxable gain.
    expect(result.summary.totalProceedsUsd).toBeCloseTo(4_000, 2);
    expect(result.summary.totalCostBasisUsd).toBeCloseTo(4_000, 2);
  });

  it('emits a CSV header plus one disposal row', () => {
    expect(result.summary.csvLineCount).toBe(2);
  });

  it('nets out to gas expense only, since the swap broke even', () => {
    // 135,000 gas * 25 gwei = 0.003375 ETH at $2,000 => $6.75
    expect(result.summary.netGainLossUsd).toBeCloseTo(-6.75, 2);
  });
});
