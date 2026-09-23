// src/services/taxSummary.ts
//
// Aggregate counts and totals for the tax dashboard. Lives in services rather
// than beside the component so the component file only exports a component,
// which keeps React Fast Refresh working.

import type { ClassifiedTransaction, TaxSummary } from '../types';

export function computeSummary(transactions: ClassifiedTransaction[]): TaxSummary {
  let tradeTotal = 0;
  let incomeTotal = 0;
  let transferCount = 0;
  let nftCount = 0;
  let unknownCount = 0;
  let totalGasSpent = 0;
  let missingPriceCount = 0;

  for (const tx of transactions) {
    const gasEth = (parseFloat(tx.gasUsed || '0') * parseFloat(tx.gasPrice || '0')) / 1e18;
    totalGasSpent += gasEth;

    if (tx.usdValue === null || tx.usdValue === undefined) {
      missingPriceCount++;
    }

    if (tx.status !== 'classified') {
      unknownCount++;
      continue;
    }

    switch (tx.category) {
      case 'trade':
        if (tx.usdValue !== null) { tradeTotal += tx.usdValue; }
        break;
      case 'income':
        if (tx.usdValue !== null) { incomeTotal += tx.usdValue; }
        break;
      case 'transfer':
        transferCount++;
        break;
      case 'nft':
        nftCount++;
        break;
      default:
        unknownCount++;
    }
  }

  return {
    tradeTotal,
    incomeTotal,
    transferCount,
    nftCount,
    unknownCount,
    totalTransactions: transactions.length,
    totalGasSpent,
    totalVolumeUsd: 0,
    missingPriceCount,
  };
}
