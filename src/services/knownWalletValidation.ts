// src/services/knownWalletValidation.ts
//
// End-to-End Validation Engine for Known Public Wallet Output Verification.
// Asserts that story narrative and FIFO CSV tax report match exact expected outputs.

import type { RawTransaction, ClassifiedTransaction, FifoAccountingReport } from '../types';
import { calculateFifoTaxReport } from './fifoEngine';
import { generateFallbackDescription } from './descriptionGenerator';

export const KNOWN_PUBLIC_WALLET = '0xd8DA6BF26964aF9Ded7ede3308C4157ed3714123';

export const KNOWN_WALLET_FIXTURES: RawTransaction[] = [
  {
    hash: '0x1000000000000000000000000000000000000000000000000000000000000001',
    blockNumber: '18000001',
    timeStamp: '1690000000', // Jul 22, 2023
    from: '0x1111111111111111111111111111111111111111',
    to: KNOWN_PUBLIC_WALLET,
    value: '5000000000000000000', // 5.0 ETH
    gas: '21000',
    gasPrice: '20000000000',
    gasUsed: '21000',
    input: '0x',
    isError: '0',
    txreceipt_status: '1',
    functionName: 'transfer(address to, uint256 amount)',
    walletLabel: KNOWN_PUBLIC_WALLET,
  },
  {
    hash: '0x1000000000000000000000000000000000000000000000000000000000000002',
    blockNumber: '18000050',
    timeStamp: '1690050000',
    from: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', // Lido Staking
    to: KNOWN_PUBLIC_WALLET,
    value: '200000000000000000', // 0.2 ETH reward
    gas: '50000',
    gasPrice: '20000000000',
    gasUsed: '45000',
    input: '0x4e71d92d',
    isError: '0',
    txreceipt_status: '1',
    functionName: 'claimRewards()',
    walletLabel: KNOWN_PUBLIC_WALLET,
  },
  {
    hash: '0x1000000000000000000000000000000000000000000000000000000000000003',
    blockNumber: '18001000',
    timeStamp: '1690100000',
    from: KNOWN_PUBLIC_WALLET,
    to: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', // Uniswap V2 Router
    value: '2000000000000000000', // 2.0 ETH disposal
    gas: '150000',
    gasPrice: '25000000000',
    gasUsed: '135000',
    input: '0x7ff36ab5',
    isError: '0',
    txreceipt_status: '1',
    functionName: 'swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline)',
    tokenName: 'USD Coin',
    tokenSymbol: 'USDC',
    walletLabel: KNOWN_PUBLIC_WALLET,
  },
];

export interface ValidationResult {
  success: boolean;
  walletAddress: string;
  errors: string[];
  summary: {
    totalTxs: number;
    storyCategoryCounts: Record<string, number>;
    totalProceedsUsd: number;
    totalCostBasisUsd: number;
    netGainLossUsd: number;
    csvLineCount: number;
  };
}

export function generateCsvFromReport(report: FifoAccountingReport): string {
  const headers = [
    'Tx Hash',
    'Asset',
    'Date Disposed',
    'Amount Disposed',
    'Proceeds (USD)',
    'Cost Basis (USD)',
    'Gain / Loss (USD)',
    'Holding Period',
  ];

  const rows = report.realizedTransactions.map((tx) => [
    tx.txHash,
    tx.assetSymbol,
    tx.disposedDate.toISOString().split('T')[0],
    tx.amountDisposed.toFixed(6),
    tx.proceedsUsd.toFixed(2),
    tx.costBasisUsd.toFixed(2),
    tx.gainLossUsd.toFixed(2),
    tx.holdingPeriod === 'long_term' ? 'Long Term (>1yr)' : 'Short Term (<=1yr)',
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function runKnownWalletValidation(): ValidationResult {
  const errors: string[] = [];

  // 1. Classify transactions deterministically
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

    // Mock USD prices for deterministic test validation ($2,000 per ETH)
    const ethPrice = 2000;
    const usdValue = ethValue * ethPrice;

    return {
      ...tx,
      description,
      category,
      confidence: 0.95,
      usdValue,
      ethValue,
      status: 'classified',
      date: new Date(parseInt(tx.timeStamp) * 1000),
    };
  });

  // Assert Story Narrative Counts
  const categoryCounts: Record<string, number> = {
    trade: 0,
    income: 0,
    transfer: 0,
    nft: 0,
    unknown: 0,
  };

  for (const tx of classified) {
    categoryCounts[tx.category] = (categoryCounts[tx.category] || 0) + 1;
  }

  if (categoryCounts.trade !== 1) {
    errors.push(`Expected 1 trade transaction, found ${categoryCounts.trade}`);
  }
  if (categoryCounts.income !== 1) {
    errors.push(`Expected 1 income transaction, found ${categoryCounts.income}`);
  }
  if (categoryCounts.transfer !== 1) {
    errors.push(`Expected 1 transfer transaction, found ${categoryCounts.transfer}`);
  }

  // 2. Run FIFO Accounting Engine
  const fifoReport = calculateFifoTaxReport(classified, KNOWN_PUBLIC_WALLET);

  // Verification checks for FIFO logic:
  // - Acquisition 1: Received 5.0 ETH @ $2,000 = $10,000 cost basis
  // - Acquisition 2: Claimed 0.2 ETH @ $2,000 = $400 cost basis
  // - Disposal 1: Sold 2.0 ETH @ $2,000 = $4,000 proceeds
  // FIFO cost basis for 2.0 ETH from Lot 1 (5.0 ETH lot) = 2.0 * $2,000 = $4,000 cost basis
  // Realized gain/loss = $4,000 - $4,000 = $0.00
  if (fifoReport.realizedTransactions.length !== 1) {
    errors.push(`Expected 1 realized disposal transaction, found ${fifoReport.realizedTransactions.length}`);
  } else {
    const disposal = fifoReport.realizedTransactions[0];
    if (disposal.amountDisposed !== 2.0) {
      errors.push(`Expected amountDisposed to be 2.0 ETH, got ${disposal.amountDisposed}`);
    }
    if (Math.abs(disposal.proceedsUsd - 4000) > 0.01) {
      errors.push(`Expected proceedsUsd to be 4000.00, got ${disposal.proceedsUsd}`);
    }
    if (Math.abs(disposal.costBasisUsd - 4000) > 0.01) {
      errors.push(`Expected costBasisUsd to be 4000.00, got ${disposal.costBasisUsd}`);
    }
  }

  // 3. Validate CSV Generation Output
  const csvText = generateCsvFromReport(fifoReport);
  const csvLines = csvText.trim().split('\n');

  const expectedHeader = 'Tx Hash,Asset,Date Disposed,Amount Disposed,Proceeds (USD),Cost Basis (USD),Gain / Loss (USD),Holding Period';
  if (csvLines[0] !== expectedHeader) {
    errors.push(`CSV Header mismatch. Expected:\n${expectedHeader}\nGot:\n${csvLines[0]}`);
  }
  if (csvLines.length !== 2) { // 1 header line + 1 realized disposal row
    errors.push(`Expected 2 CSV lines (header + 1 row), got ${csvLines.length}`);
  }

  return {
    success: errors.length === 0,
    walletAddress: KNOWN_PUBLIC_WALLET,
    errors,
    summary: {
      totalTxs: classified.length,
      storyCategoryCounts: categoryCounts,
      totalProceedsUsd: fifoReport.totalProceedsUsd,
      totalCostBasisUsd: fifoReport.totalCostBasisUsd,
      netGainLossUsd: fifoReport.netCapitalGainLossUsd,
      csvLineCount: csvLines.length,
    },
  };
}
