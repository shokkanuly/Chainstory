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
  const netGainLoss = (summary.realizedGainTotal || 0) - (summary.realizedLossTotal || 0);

  return (
    <div className="dashboard">
      <div className="dashboard-title-row">
        <h3 className="dashboard-section-title">FIFO Tax &amp; Portfolio Summary Dashboard</h3>
        <span className="dashboard-pill">IRS 1099-DA Ready</span>
      </div>

      {/* Main Stat Cards Grid */}
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">Realized Capital Gain/Loss</span>
            <span className="stat-card-badge trade-badge">FIFO Lots</span>
          </div>
          <div className={`stat-card-value ${netGainLoss > 0 ? 'positive' : netGainLoss < 0 ? 'negative' : 'neutral'}`}>
            {netGainLoss > 0 ? '+' : ''}{formatUsd(netGainLoss)}
          </div>
          <div className="stat-card-sub">
            Gains: +{formatUsd(summary.realizedGainTotal || 0)} | Losses: -{formatUsd(summary.realizedLossTotal || 0)}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">Staking &amp; Rewards Income</span>
            <span className="stat-card-badge income-badge">Ordinary Income</span>
          </div>
          <div className={`stat-card-value ${summary.incomeTotal > 0 ? 'positive' : 'neutral'}`}>
            {formatUsd(summary.incomeTotal)}
          </div>
          <div className="stat-card-sub">Staking, yield farming &amp; airdrops</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">Transfers &amp; Wraps</span>
            <span className="stat-card-badge transfer-badge">Non-Taxable</span>
          </div>
          <div className="stat-card-value neutral">{summary.transferCount}</div>
          <div className="stat-card-sub">Wallet-to-wallet &amp; WETH wrapping</div>
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
            <span className="metric-label">Deductible Network Gas Fees</span>
            <span className="metric-value">{summary.totalGasSpent.toFixed(4)} ETH</span>
          </div>
        </div>

        <div className="metric-item">
          <span className="metric-icon">📊</span>
          <div className="metric-text">
            <span className="metric-label">Total Asset Cost Basis</span>
            <span className="metric-value">{formatUsd(summary.totalCostBasis || 0)}</span>
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
  let realizedGainTotal = 0;
  let realizedLossTotal = 0;
  let totalCostBasis = 0;

  for (const tx of transactions) {
    const gasEth = (parseFloat(tx.gasUsed || '0') * parseFloat(tx.gasPrice || '0')) / 1e18;
    totalGasSpent += gasEth;

    if (tx.usdValue !== null && tx.usdValue > 0) {
      totalVolumeUsd += tx.usdValue;
    }

    if (tx.realizedGainLoss) {
      if (tx.realizedGainLoss.gainLossUsd >= 0) {
        realizedGainTotal += tx.realizedGainLoss.gainLossUsd;
      } else {
        realizedLossTotal += Math.abs(tx.realizedGainLoss.gainLossUsd);
      }
      totalCostBasis += tx.realizedGainLoss.costBasisUsd;
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
    realizedGainTotal,
    realizedLossTotal,
    totalCostBasis,
    netTaxableIncome: realizedGainTotal - realizedLossTotal,
  };
}
