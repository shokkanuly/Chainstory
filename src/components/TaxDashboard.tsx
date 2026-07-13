// src/components/TaxDashboard.tsx
import type { ClassifiedTransaction, TaxSummary } from '../types';

interface Props {
  summary: TaxSummary;
}

function formatUsd(value: number): string {
  if (value === 0) return '$0.00';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export default function TaxDashboard({ summary }: Props) {
  return (
    <div className="dashboard">
      {/* Stat cards */}
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card-label">Capital gains</div>
          <div className={`stat-card-value ${summary.tradeTotal > 0 ? 'positive' : summary.tradeTotal < 0 ? 'negative' : 'neutral'}`}>
            {summary.tradeTotal > 0 ? '+' : ''}{formatUsd(summary.tradeTotal)}
          </div>
          <div className="stat-card-sub">from trades &amp; swaps</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-label">Income events</div>
          <div className={`stat-card-value ${summary.incomeTotal > 0 ? 'positive' : 'neutral'}`}>
            {formatUsd(summary.incomeTotal)}
          </div>
          <div className="stat-card-sub">staking, airdrops, rewards</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-label">Transfers</div>
          <div className="stat-card-value neutral">{summary.transferCount}</div>
          <div className="stat-card-sub">non-taxable events</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-label">NFT Events</div>
          <div className="stat-card-value neutral">{summary.nftCount}</div>
          <div className="stat-card-sub">mints, sales, transfers</div>
        </div>
      </div>

      {/* Gas summary */}
      <div className="gas-summary">
        <span className="gas-icon">⛽</span>
        <span>Total gas spent: <strong>{summary.totalGasSpent.toFixed(4)} ETH</strong></span>
        <span className="gas-note">(may be tax-deductible in some jurisdictions)</span>
      </div>
    </div>
  );
}

export function computeSummary(transactions: ClassifiedTransaction[]): TaxSummary {
  let tradeTotal = 0;
  let incomeTotal = 0;
  let transferCount = 0;
  let nftCount = 0;
  let unknownCount = 0;
  let totalGasSpent = 0;

  for (const tx of transactions) {
    const gasEth = (parseFloat(tx.gasUsed) * parseFloat(tx.gasPrice)) / 1e18;
    totalGasSpent += gasEth;

    if (tx.status !== 'classified') {
      unknownCount++;
      continue;
    }

    switch (tx.category) {
      case 'trade':
        if (tx.usdValue !== null) {
          tradeTotal += tx.usdValue;
        }
        break;
      case 'income':
        if (tx.usdValue !== null) {
          incomeTotal += tx.usdValue;
        }
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
  };
}
