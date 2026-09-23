// Regression tests for the FIFO cost-basis engine.
//
// Every case here maps to a defect that shipped: the asset-symbol mismatch
// that dropped swap disposals, gas charged to recipients, and multi-lot
// disposals collapsing to a single row.

import { describe, expect, it } from 'vitest';
import { calculateFifoTaxReport } from '../fifoEngine';
import { classifiedTx } from './factories';

const WALLET = '0xd8DA6BF26964aF9Ded7ede3308C4157ed3714123';
const OTHER = '0x1111111111111111111111111111111111111111';

const ONE_ETH = '1000000000000000000';

describe('calculateFifoTaxReport', () => {
  it('matches an ETH lot when the disposal is a swap annotated with the token received', () => {
    // The original bug: tokenSymbol 'USDC' on an ETH-denominated swap made the
    // engine look for USDC lots, find none, and report zero cost basis.
    const acquire = classifiedTx({
      from: OTHER,
      to: WALLET,
      value: '5000000000000000000',
      usdValue: 10_000,
      timeStamp: '1690000000',
    });
    const swap = classifiedTx({
      from: WALLET,
      to: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
      value: '2000000000000000000',
      usdValue: 4_000,
      tokenSymbol: 'USDC',
      tokenName: 'USD Coin',
      category: 'trade',
      timeStamp: '1690100000',
    });

    const report = calculateFifoTaxReport([acquire, swap], WALLET);

    expect(report.realizedTransactions).toHaveLength(1);
    expect(report.realizedTransactions[0].assetSymbol).toBe('ETH');
    expect(report.realizedTransactions[0].amountDisposed).toBeCloseTo(2, 10);
    expect(report.totalCostBasisUsd).toBeCloseTo(4_000, 6);
    expect(report.totalProceedsUsd).toBeCloseTo(4_000, 6);
    expect(report.unmatchedDisposalCount).toBe(0);
  });

  it('charges gas to the sender only', () => {
    // gasUsed 21000 * 1 gwei = 0.000021 ETH; at $2000 => $0.042
    const incoming = classifiedTx({
      from: OTHER,
      to: WALLET,
      value: ONE_ETH,
      usdValue: 2_000,
      gasUsed: '21000',
      gasPrice: '1000000000',
      ethPriceUsd: 2_000,
    });

    const received = calculateFifoTaxReport([incoming], WALLET);
    expect(received.totalGasExpenseUsd).toBe(0);

    const outgoing = classifiedTx({
      from: WALLET,
      to: OTHER,
      value: ONE_ETH,
      usdValue: 2_000,
      gasUsed: '21000',
      gasPrice: '1000000000',
      ethPriceUsd: 2_000,
    });

    const sent = calculateFifoTaxReport([outgoing], WALLET);
    expect(sent.totalGasExpenseUsd).toBeCloseTo(0.042, 6);
  });

  it('prices gas from the native rate, not the asset value', () => {
    // A USDC transfer whose usdValue is the TOKEN's value. Back-deriving an
    // ETH price from usdValue/amount would give $1/ETH and understate gas.
    const tokenSend = classifiedTx({
      from: WALLET,
      to: OTHER,
      value: '1000000',
      isTokenTransfer: true,
      tokenSymbol: 'USDC',
      tokenDecimal: '6',
      usdValue: 1,
      gasUsed: '50000',
      gasPrice: '20000000000', // 0.001 ETH total
      ethPriceUsd: 3_000,
    });

    const report = calculateFifoTaxReport([tokenSend], WALLET);
    expect(report.totalGasExpenseUsd).toBeCloseTo(3, 6); // 0.001 ETH * $3000
  });

  it('emits one row per consumed lot when a disposal spans several', () => {
    const lotA = classifiedTx({
      from: OTHER, to: WALLET, value: ONE_ETH, usdValue: 1_000, timeStamp: '1600000000',
    });
    const lotB = classifiedTx({
      from: OTHER, to: WALLET, value: ONE_ETH, usdValue: 2_000, timeStamp: '1600100000',
    });
    const disposal = classifiedTx({
      from: WALLET, to: OTHER, value: '2000000000000000000', usdValue: 6_000, timeStamp: '1700000000',
    });

    const report = calculateFifoTaxReport([lotA, lotB, disposal], WALLET);

    expect(report.realizedTransactions).toHaveLength(2);
    expect(disposal.realizedGainLosses).toHaveLength(2);
    // FIFO: cheapest/oldest lot first.
    expect(report.realizedTransactions[0].costBasisUsd).toBeCloseTo(1_000, 6);
    expect(report.realizedTransactions[1].costBasisUsd).toBeCloseTo(2_000, 6);
    expect(report.totalCostBasisUsd).toBeCloseTo(3_000, 6);
    // Proceeds are apportioned, not double counted.
    expect(report.totalProceedsUsd).toBeCloseTo(6_000, 6);
  });

  it('flags a disposal with no matching lot instead of booking zero basis', () => {
    const disposal = classifiedTx({
      from: WALLET, to: OTHER, value: ONE_ETH, usdValue: 3_000,
    });

    const report = calculateFifoTaxReport([disposal], WALLET);

    expect(report.unmatchedDisposalCount).toBe(1);
    expect(report.unmatchedDisposalAmounts.ETH).toBeCloseTo(1, 10);
    expect(report.realizedTransactions).toHaveLength(0);
    // No phantom gain from a basis we never knew.
    expect(report.totalRealizedGainUsd).toBe(0);
  });

  it('classifies holding period at the 365-day boundary', () => {
    const acquire = classifiedTx({
      from: OTHER, to: WALLET, value: ONE_ETH, usdValue: 1_000, timeStamp: '1600000000',
    });
    const disposal = classifiedTx({
      from: WALLET, to: OTHER, value: ONE_ETH, usdValue: 2_000,
      timeStamp: String(1600000000 + 366 * 86400),
    });

    const report = calculateFifoTaxReport([acquire, disposal], WALLET);
    expect(report.realizedTransactions[0].holdingPeriod).toBe('long_term');
  });

  it('keeps separate lot queues per asset', () => {
    const ethLot = classifiedTx({
      from: OTHER, to: WALLET, value: ONE_ETH, usdValue: 2_000, timeStamp: '1600000000',
    });
    const usdcLot = classifiedTx({
      from: OTHER, to: WALLET, value: '1000000000', isTokenTransfer: true,
      tokenSymbol: 'USDC', tokenDecimal: '6', usdValue: 1_000, timeStamp: '1600100000',
    });
    const usdcSale = classifiedTx({
      from: WALLET, to: OTHER, value: '1000000000', isTokenTransfer: true,
      tokenSymbol: 'USDC', tokenDecimal: '6', usdValue: 1_200, timeStamp: '1700000000',
    });

    const report = calculateFifoTaxReport([ethLot, usdcLot, usdcSale], WALLET);

    expect(report.realizedTransactions).toHaveLength(1);
    expect(report.realizedTransactions[0].assetSymbol).toBe('USDC');
    expect(report.realizedTransactions[0].amountDisposed).toBeCloseTo(1_000, 6);
    // The ETH lot is untouched.
    expect(report.remainingOpenLots.some((l) => l.assetSymbol === 'ETH')).toBe(true);
  });
});
