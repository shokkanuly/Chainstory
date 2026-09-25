// src/components/TaxDashboard.tsx — Premium FIFO Tax Dashboard
import type { ChainId, TaxSummary } from '../types';
import {
  InlineIcon,
  ChartLineUpIcon,
  DiamondIcon,
  ArrowsLeftRightIcon,
  ImageSquareIcon,
  ChartPieSliceIcon,
  GasPumpIcon,
  WarningIcon,
} from './icons';
import { getChainConfig } from '../services/chains';
import { motion } from 'framer-motion';
import AnimatedNumber from './AnimatedNumber';
import { useStagger } from '../lib/motion';

interface Props {
  /** Drives the native gas symbol: ETH on most chains, POL on Polygon. */
  chainId?: ChainId | 'all';
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
    icon: ChartLineUpIcon,
    sub: 'from trades & swaps',
    getValue: (s: TaxSummary) => s.tradeTotal,
    format: (v: number) => `${v > 0 ? '+' : ''}${formatUsd(v)}`,
    getVariant: (v: number) => v > 0 ? 'positive' : v < 0 ? 'negative' : 'neutral',
  },
  {
    key: 'income',
    label: 'Income Events',
    icon: DiamondIcon,
    sub: 'staking, airdrops, rewards',
    getValue: (s: TaxSummary) => s.incomeTotal,
    format: (v: number) => formatUsd(v),
    getVariant: (v: number) => v > 0 ? 'positive' : 'neutral',
  },
  {
    key: 'transfers',
    label: 'Transfers',
    icon: ArrowsLeftRightIcon,
    sub: 'non-taxable events',
    getValue: (s: TaxSummary) => s.transferCount,
    format: (v: number) => String(v),
    getVariant: () => 'neutral' as const,
  },
  {
    key: 'nft',
    label: 'NFT Events',
    icon: ImageSquareIcon,
    sub: 'mints, sales, transfers',
    getValue: (s: TaxSummary) => s.nftCount,
    format: (v: number) => String(v),
    getVariant: () => 'neutral' as const,
  },
];

export default function TaxDashboard({ summary, chainId = 'ethereum' }: Props) {
  // Sequence communicates that these were computed together, in order.
  const { container, child } = useStagger();

  return (
    <div className="dashboard">
      <div className="dashboard-header-row">
        <h3 className="dashboard-title">
          <InlineIcon icon={ChartPieSliceIcon} size={16} />
          Tax Summary
          <span className="text-xs font-medium text-muted-foreground ml-1">
            · {summary.totalTransactions} transactions
          </span>
        </h3>
      </div>

      <motion.div
        className="stat-cards"
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.3 }}
      >
        {STAT_CARDS.map((card) => {
          const value = card.getValue(summary);
          const variant = card.getVariant(value);
          return (
            <motion.div key={card.key} className="stat-card" variants={child}>
              <div className="flex items-center justify-between">
                <span className="stat-card-label">{card.label}</span>
                <span className="text-base"><InlineIcon icon={card.icon} size={16} /></span>
              </div>
              <div className={`stat-card-value ${variant}`}>
                <AnimatedNumber value={value} format={card.format} />
              </div>
              <div className="stat-card-sub">{card.sub}</div>
            </motion.div>
          );
        })}
      </motion.div>

      <div className="gas-summary flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="gas-icon"><InlineIcon icon={GasPumpIcon} size={15} /></span>
          <span>Total gas spent: <strong className="text-foreground">{summary.totalGasSpent.toFixed(4)} {chainId === 'all' ? 'ETH' : getChainConfig(chainId).symbol}</strong></span>
          <span className="gas-note">(may be tax-deductible)</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {summary.missingPriceCount && summary.missingPriceCount > 0 ? (
            <div className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-3 py-1 rounded-lg">
              <InlineIcon icon={WarningIcon} size={12} /> Price data unavailable for {summary.missingPriceCount} transaction(s).
            </div>
          ) : null}

          {summary.unmatchedDisposalCount && summary.unmatchedDisposalCount > 0 ? (
            <div className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-3 py-1 rounded-lg">
              <InlineIcon icon={WarningIcon} size={12} /> {summary.unmatchedDisposalCount} disposal(s) have no matching acquisition in this
              window, so their cost basis is unknown — the gain shown is an upper bound.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
