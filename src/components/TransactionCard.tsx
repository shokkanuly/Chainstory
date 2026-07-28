// src/components/TransactionCard.tsx — Premium Transaction Card
import type { ClassifiedTransaction, TaxCategory } from '../types';
import { formatAddress } from '../services/etherscan';

interface Props {
  tx: ClassifiedTransaction;
  index: number;
}

const CATEGORY_META: Record<TaxCategory | 'unknown', { label: string; icon: string; className: string }> = {
  trade: { label: 'Trade', icon: '💱', className: 'cat-trade' },
  income: { label: 'Income', icon: '💎', className: 'cat-income' },
  transfer: { label: 'Transfer', icon: '↔️', className: 'cat-transfer' },
  nft: { label: 'NFT', icon: '🖼️', className: 'cat-nft' },
  unknown: { label: 'Unknown', icon: '❓', className: 'cat-unknown' },
};

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatUsd(value: number): string {
  if (!value) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export default function TransactionCard({ tx, index }: Props) {
  const meta = CATEGORY_META[tx.category];
  const isLoading = tx.status === 'classifying' || tx.status === 'pending';
  const isFailed = tx.isError === '1';

  return (
    <div
      className={`tx-card ${isLoading ? 'tx-card--loading' : ''} ${isFailed ? 'tx-card--failed' : ''}`}
      style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
    >
      <div className="tx-card-inner">
        {/* Header: date + category */}
        <div className="tx-card-header">
          <div className="tx-date">
            <span className="tx-date-main">{formatDate(tx.date)}</span>
            <span className="tx-date-time">{formatTime(tx.date)}</span>
          </div>
          <div className="tx-card-right">
            <span className={`category-tag ${meta.className}`}>
              {meta.icon} {meta.label}
            </span>
            {isFailed && <span className="failed-badge">Failed</span>}
          </div>
        </div>

        {/* Description */}
        {isLoading ? (
          <div className="skeleton-line" />
        ) : (
          <p className="tx-description">{tx.description}</p>
        )}

        {/* Values */}
        <div className="tx-values">
          <div className="tx-value-item">
            <span className="tx-value-label">ETH</span>
            <span className="tx-value-amount">{tx.ethValue.toFixed(4)} ETH</span>
          </div>
          {tx.usdValue === null ? (
            <div className="tx-value-item">
              <span className="tx-value-label">USD at time</span>
              <span className="tx-value-amount price-unavailable">price unavailable</span>
            </div>
          ) : tx.usdValue > 0 ? (
            <div className="tx-value-item">
              <span className="tx-value-label">USD at time</span>
              <span className="tx-value-amount usd">{formatUsd(tx.usdValue)}</span>
            </div>
          ) : null}
          {isLoading && (
            <div className="tx-value-item">
              <span className="skeleton-line" style={{ width: '80px', height: '16px' }} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="tx-footer">
          <div className="tx-addresses">
            <span className="tx-addr-label">From</span>
            <span className="tx-addr">{formatAddress(tx.from)}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tx-arrow">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
            <span className="tx-addr-label">To</span>
            <span className="tx-addr">{formatAddress(tx.to)}</span>
          </div>
          <a
            href={`https://etherscan.io/tx/${tx.hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="tx-hash-link"
            title={tx.hash}
          >
            {tx.hash.slice(0, 10)}…
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        </div>

        {/* Confidence bar */}
        {tx.status === 'classified' && tx.confidence > 0 && (
          <div className="tx-confidence">
            <div className="tx-confidence-bar" style={{ width: `${tx.confidence * 100}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
