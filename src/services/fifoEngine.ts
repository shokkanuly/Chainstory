// src/services/fifoEngine.ts
//
// Strict First-In, First-Out (FIFO) cost-basis accounting engine.
// Produces the figures behind the DRAFT Form 8949 / Schedule D export.
//
// Accounting rules applied here:
//   - Lots are opened per (asset, wallet) on acquisition and retired oldest-first.
//   - A disposal may span several lots; each consumed lot yields its own
//     realized gain/loss row, because holding periods differ per lot.
//   - Gas is an expense of the SENDER only. A transaction the wallet merely
//     received cost it nothing.
//   - Gas is priced with the native-token price at that timestamp, never
//     back-derived from the transaction's own USD value (which is the *asset*
//     value, and is meaningless for token transfers).
//   - A disposal with no matching lot is recorded as unmatched rather than
//     silently booked at zero cost basis, which would overstate the gain.

import type {
  ClassifiedTransaction,
  FifoAccountingReport,
  RealizedGainLoss,
  TaxLot,
} from '../types';
import { gasCostInNative, isOutgoing, resolveAsset } from './assetResolver';

const DAY_MS = 1000 * 60 * 60 * 24;
const LONG_TERM_THRESHOLD_DAYS = 365;

export function calculateFifoTaxReport(
  transactions: ClassifiedTransaction[],
  walletAddress: string
): FifoAccountingReport {
  // FIFO is order-dependent: always process oldest first.
  const sortedTxs = [...transactions].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );

  // Open lots per asset symbol, each list held in acquisition order.
  const openLotsByAsset = new Map<string, TaxLot[]>();
  const realizedTransactions: RealizedGainLoss[] = [];
  const unmatchedDisposalAmounts: Record<string, number> = {};

  let totalProceedsUsd = 0;
  let totalCostBasisUsd = 0;
  let totalRealizedGainUsd = 0;
  let totalRealizedLossUsd = 0;
  let totalGasExpenseUsd = 0;
  let missingPriceCount = 0;
  let unmatchedDisposalCount = 0;

  for (const tx of sortedTxs) {
    const { symbol: assetSymbol, amount } = resolveAsset(tx);
    const usdValue = tx.usdValue ?? 0;
    const date = tx.date;

    if (tx.usdValue === null || tx.usdValue === undefined) {
      missingPriceCount++;
    }

    const outgoing = isOutgoing(tx, walletAddress);

    // 1. Gas — charged to the sender only, priced with the native-token rate.
    let gasUsd = 0;
    if (outgoing) {
      const gasNative = gasCostInNative(tx);
      // ethPriceUsd is populated by the classifier. Fall back to deriving it
      // from a native-asset transfer, where usdValue/amount IS the unit price.
      const nativePrice =
        tx.ethPriceUsd ?? (amount > 0 && usdValue > 0 && !tx.isTokenTransfer ? usdValue / amount : 0);
      gasUsd = gasNative * nativePrice;
      totalGasExpenseUsd += gasUsd;
    }

    if (amount <= 0) continue;

    // 2. Acquisition — anything received opens a lot, including income.
    if (!outgoing) {
      const unitCostUsd = usdValue / amount;
      const lots = openLotsByAsset.get(assetSymbol) ?? [];
      lots.push({
        id: `lot_${tx.hash}_${date.getTime()}`,
        walletAddress,
        assetSymbol,
        amount,
        costBasisUsd: unitCostUsd,
        totalCostUsd: usdValue,
        acquiredDate: date,
        txHash: tx.hash,
        remainingAmount: amount,
      });
      openLotsByAsset.set(assetSymbol, lots);
      continue;
    }

    // 3. Disposal — retire oldest lots of the SAME asset first.
    let remainingToDispose = amount;
    const saleProceedsUsd = usdValue;
    const lots = openLotsByAsset.get(assetSymbol) ?? [];
    const disposalRows: RealizedGainLoss[] = [];

    for (const lot of lots) {
      if (remainingToDispose <= 0) break;
      if (lot.remainingAmount <= 0) continue;

      const amountFromThisLot = Math.min(lot.remainingAmount, remainingToDispose);
      const costForThisPart = amountFromThisLot * lot.costBasisUsd;

      lot.remainingAmount -= amountFromThisLot;
      remainingToDispose -= amountFromThisLot;

      const daysHeld = (date.getTime() - lot.acquiredDate.getTime()) / DAY_MS;
      const holdingPeriod = daysHeld > LONG_TERM_THRESHOLD_DAYS ? 'long_term' : 'short_term';

      // Proceeds are apportioned by the share of the disposal this lot covers.
      const portionProceeds = (amountFromThisLot / amount) * saleProceedsUsd;
      const gainLoss = portionProceeds - costForThisPart;

      if (gainLoss >= 0) {
        totalRealizedGainUsd += gainLoss;
      } else {
        totalRealizedLossUsd += Math.abs(gainLoss);
      }

      totalCostBasisUsd += costForThisPart;

      disposalRows.push({
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
    }

    // Anything left over was acquired before our fetch window — its basis is
    // unknown. Record it instead of pretending the basis was zero.
    if (remainingToDispose > 1e-12) {
      unmatchedDisposalCount++;
      unmatchedDisposalAmounts[assetSymbol] =
        (unmatchedDisposalAmounts[assetSymbol] ?? 0) + remainingToDispose;
    }

    if (disposalRows.length > 0) {
      realizedTransactions.push(...disposalRows);
      // Attach every consumed lot, not just the last one.
      tx.realizedGainLosses = disposalRows;
      totalProceedsUsd += disposalRows.reduce((sum, row) => sum + row.proceedsUsd, 0);
    }
  }

  const remainingOpenLots = Array.from(openLotsByAsset.values())
    .flat()
    .filter((lot) => lot.remainingAmount > 0);

  const netCapitalGainLossUsd =
    totalRealizedGainUsd - totalRealizedLossUsd - totalGasExpenseUsd;

  return {
    walletAddress,
    totalProceedsUsd,
    totalCostBasisUsd,
    totalRealizedGainUsd,
    totalRealizedLossUsd,
    totalGasExpenseUsd,
    netCapitalGainLossUsd,
    missingPriceCount,
    unmatchedDisposalCount,
    unmatchedDisposalAmounts,
    realizedTransactions,
    remainingOpenLots,
  };
}
