// src/services/fifoEngine.ts
//
// Strict First-In, First-Out (FIFO) Tax & Cost Basis Accounting Engine
// Compliant with IRS Form 8949 & 2026 1099-DA rules.
// Tracks acquisition tax lots per asset/wallet, matches disposals, and deducts gas expenses.

import type {
  ClassifiedTransaction,
  FifoAccountingReport,
  RealizedGainLoss,
  TaxLot,
} from '../types';

export function calculateFifoTaxReport(
  transactions: ClassifiedTransaction[],
  walletAddress: string
): FifoAccountingReport {
  // Sort transactions chronologically: oldest first
  const sortedTxs = [...transactions].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );

  const openLots: TaxLot[] = [];
  const realizedTransactions: RealizedGainLoss[] = [];

  let totalProceedsUsd = 0;
  let totalCostBasisUsd = 0;
  let totalRealizedGainUsd = 0;
  let totalRealizedLossUsd = 0;
  let totalGasExpenseUsd = 0;

  for (const tx of sortedTxs) {
    const assetSymbol = tx.tokenSymbol || 'ETH';
    const ethVal = tx.ethValue || 0;
    const usdVal = tx.usdValue || 0;
    const date = tx.date;

    // 1. Accumulate gas fee as deductible expense/capital loss
    const gasEth = (parseFloat(tx.gasUsed || '0') * parseFloat(tx.gasPrice || '0')) / 1e18;
    const ethPriceAtTx = ethVal > 0 && usdVal > 0 ? usdVal / ethVal : 0;
    const gasUsd = gasEth * ethPriceAtTx;
    totalGasExpenseUsd += gasUsd;

    // 2. Process incoming assets (Acquisitions / Buy / Staking Income)
    const isIncoming = tx.from.toLowerCase() !== walletAddress.toLowerCase() || tx.category === 'income';

    if (isIncoming && ethVal > 0) {
      const unitCostUsd = ethVal > 0 ? usdVal / ethVal : 0;
      const newLot: TaxLot = {
        id: `lot_${tx.hash}_${date.getTime()}`,
        walletAddress,
        assetSymbol,
        amount: ethVal,
        costBasisUsd: unitCostUsd,
        totalCostUsd: usdVal,
        acquiredDate: date,
        txHash: tx.hash,
        remainingAmount: ethVal,
      };
      openLots.push(newLot);
    } 
    // 3. Process outgoing assets (Disposals / Sales / Trades)
    else if (!isIncoming && ethVal > 0) {
      let remainingToDispose = ethVal;
      const saleProceedsUsd = usdVal;
      let totalLotCostBasisUsd = 0;

      // Find matching open lots for this asset in FIFO order
      const matchingLots = openLots.filter(
        (lot) => lot.assetSymbol === assetSymbol && lot.remainingAmount > 0
      );

      for (const lot of matchingLots) {
        if (remainingToDispose <= 0) break;

        const amountFromThisLot = Math.min(lot.remainingAmount, remainingToDispose);
        const costForThisPart = amountFromThisLot * lot.costBasisUsd;

        lot.remainingAmount -= amountFromThisLot;
        remainingToDispose -= amountFromThisLot;
        totalLotCostBasisUsd += costForThisPart;

        // Calculate holding period (short_term <= 365 days, long_term > 365 days)
        const daysHeld = (date.getTime() - lot.acquiredDate.getTime()) / (1000 * 60 * 60 * 24);
        const holdingPeriod = daysHeld > 365 ? 'long_term' : 'short_term';

        const portionProceeds = ethVal > 0 ? (amountFromThisLot / ethVal) * saleProceedsUsd : 0;
        const gainLoss = portionProceeds - costForThisPart;

        if (gainLoss >= 0) {
          totalRealizedGainUsd += gainLoss;
        } else {
          totalRealizedLossUsd += Math.abs(gainLoss);
        }

        realizedTransactions.push({
          txHash: tx.hash,
          assetSymbol,
          amountDisposed: amountFromThisLot,
          proceedsUsd: portionProceeds,
          costBasisUsd: costForThisPart,
          gainLossUsd: gainLoss,
          holdingPeriod,
          disposedDate: date,
          gasDeductionUsd: gasUsd,
        });

        // Attach realized gain/loss directly to transaction for UI rendering
        tx.realizedGainLoss = {
          txHash: tx.hash,
          assetSymbol,
          amountDisposed: amountFromThisLot,
          proceedsUsd: portionProceeds,
          costBasisUsd: costForThisPart,
          gainLossUsd: gainLoss,
          holdingPeriod,
          disposedDate: date,
          gasDeductionUsd: gasUsd,
        };
      }

      totalProceedsUsd += saleProceedsUsd;
      totalCostBasisUsd += totalLotCostBasisUsd;
    }
  }

  const netCapitalGainLossUsd = totalRealizedGainUsd - totalRealizedLossUsd - totalGasExpenseUsd;

  return {
    walletAddress,
    totalProceedsUsd,
    totalCostBasisUsd,
    totalRealizedGainUsd,
    totalRealizedLossUsd,
    totalGasExpenseUsd,
    netCapitalGainLossUsd,
    realizedTransactions,
    remainingOpenLots: openLots.filter((lot) => lot.remainingAmount > 0),
  };
}
