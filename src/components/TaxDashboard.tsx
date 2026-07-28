// src/components/TaxDashboard.tsx — Premium FIFO Tax Dashboard
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

const STAT_CARDS = [
  {
    key: 'gains',
    label: 'Capital Gains',
    icon: '📈',
    sub: 'from trades & swaps',
    getValue: (s: TaxSummary) => s.tradeTotal,
    format: (v: number) => `${v > 0 ? '+' : ''}${formatUsd(v)}`,
    getVariant: (v: number) => v > 0 ? 'positive' : v < 0 ? 'negative' : 'neutral',
  },
  {
    key: 'income',
    label: 'Income Events',
    icon: '💎',
    sub: 'staking, airdrops, rewards',
    getValue: (s: TaxSummary) => s.incomeTotal,
    format: (v: number) => formatUsd(v),
    getVariant: (v: number) => v > 0 ? 'positive' : 'neutral',
  },
  {
    key: 'transfers',
    label: 'Transfers',
    icon: '↔️',
    sub: 'non-taxable events',
    getValue: (s: TaxSummary) => s.transferCount,
    format: (v: number) => String(v),
    getVariant: () => 'neutral' as const,
  },
  {
    key: 'nft',
    label: 'NFT Events',
    icon: '🖼️',
    sub: 'mints, sales, transfers',
    getValue: (s: TaxSummary) => s.nftCount,
    format: (v: number) => String(v),
    getVariant: () => 'neutral' as const,
  },
];

export default function TaxDashboard({ summary }: Props) {
  return (
    <div className="dashboard">
      <div className="dashboard-header-row">
        <h3 className="dashboard-title">
          <span>📊</span>
          Tax Summary
          <span className="text-xs font-medium text-muted-foreground ml-1">
            · {summary.totalTransactions} transactions
          </span>
        </h3>
      </div>

      <div className="stat-cards">
        {STAT_CARDS.map((card) => {
          const value = card.getValue(summary);
          const variant = card.getVariant(value);
          return (
            <div key={card.key} className="stat-card">
              <div className="flex items-center justify-between">
                <span className="stat-card-label">{card.label}</span>
                <span className="text-base">{card.icon}</span>
              </div>
              <div className={`stat-card-value ${variant}`}>
                {card.format(value)}
              </div>
              <div className="stat-card-sub">{card.sub}</div>
            </div>
          );
        })}
      </div>

      <div className="gas-summary">
        <div className="flex items-center gap-2">
          <span className="gas-icon">⛽</span>
          <span>Total gas spent: <strong className="text-foreground">{summary.totalGasSpent.toFixed(4)} ETH</strong></span>
        </div>
        <span className="gas-note">(may be tax-deductible)</span>
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
  };
}
