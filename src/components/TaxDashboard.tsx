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
      <div className="dashboard-title-row">
        <h3 className="dashboard-section-title">Tax &amp; Activity Summary Dashboard</h3>
        <span className="dashboard-pill">Portfolio Metrics</span>
      </div>

      {/* Main Stat Cards Grid */}
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">Capital Gains / Losses</span>
            <span className="stat-card-badge trade-badge">Trades &amp; Swaps</span>
          </div>
          <div className={`stat-card-value ${summary.tradeTotal > 0 ? 'positive' : summary.tradeTotal < 0 ? 'negative' : 'neutral'}`}>
            {summary.tradeTotal > 0 ? '+' : ''}{formatUsd(summary.tradeTotal)}
          </div>
          <div className="stat-card-sub">Estimated net taxable trading value</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">Income Events</span>
            <span className="stat-card-badge income-badge">Staking &amp; Rewards</span>
          </div>
          <div className={`stat-card-value ${summary.incomeTotal > 0 ? 'positive' : 'neutral'}`}>
            {formatUsd(summary.incomeTotal)}
          </div>
          <div className="stat-card-sub">Staking, yield farming &amp; airdrops</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">Transfers</span>
            <span className="stat-card-badge transfer-badge">Non-Taxable</span>
          </div>
          <div className="stat-card-value neutral">{summary.transferCount}</div>
          <div className="stat-card-sub">Wallet-to-wallet &amp; simple sends</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">NFT Events</span>
            <span className="stat-card-badge nft-badge">Mints &amp; Sales</span>
          </div>
          <div className="stat-card-value neutral">{summary.nftCount}</div>
          <div className="stat-card-sub">NFT mints, purchases &amp; sales</div>
        </div>
      </div>

      {/* Gas & Volume Summary Bar */}
      <div className="metrics-bar">
        <div className="metric-item">
          <span className="metric-icon">⛽</span>
          <div className="metric-text">
            <span className="metric-label">Total Gas Fees Paid</span>
            <span className="metric-value">{summary.totalGasSpent.toFixed(4)} ETH</span>
          </div>
        </div>

        <div className="metric-item">
          <span className="metric-icon">📊</span>
          <div className="metric-text">
            <span className="metric-label">Total Volume Tracked</span>
            <span className="metric-value">{formatUsd(summary.totalVolumeUsd)}</span>
          </div>
        </div>

        <div className="metric-item">
          <span className="metric-icon">🧾</span>
          <div className="metric-text">
            <span className="metric-label">Total Transactions</span>
            <span className="metric-value">{summary.totalTransactions} txs</span>
          </div>
        </div>
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
  let totalVolumeUsd = 0;

  for (const tx of transactions) {
    const gasEth = (parseFloat(tx.gasUsed || '0') * parseFloat(tx.gasPrice || '0')) / 1e18;
    totalGasSpent += gasEth;

    if (tx.usdValue !== null && tx.usdValue > 0) {
      totalVolumeUsd += tx.usdValue;
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
    totalVolumeUsd,
  };
}
