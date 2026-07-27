// src/components/TransactionCard.tsx
import { useState } from 'react';
import type { ClassifiedTransaction, TaxCategory, TimelineViewMode } from '../types';
import { formatAddress, weiToEth } from '../services/etherscan';

interface Props {
  tx: ClassifiedTransaction;
  index: number;
  viewMode?: TimelineViewMode;
}

const CATEGORY_META: Record<TaxCategory | 'unknown', { label: string; icon: string; className: string }> = {
  trade: { label: 'Trade', icon: '💱', className: 'cat-trade' },
  income: { label: 'Income', icon: '💎', className: 'cat-income' },
  transfer: { label: 'Transfer', icon: '↔️', className: 'cat-transfer' },
  nft: { label: 'NFT Event', icon: '🖼️', className: 'cat-nft' },
  unknown: { label: 'Uncategorized', icon: '❓', className: 'cat-unknown' },
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

export default function TransactionCard({ tx, index, viewMode = 'classified' }: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const meta = CATEGORY_META[tx.category] || CATEGORY_META.unknown;
  const isLoading = tx.status === 'classifying' || tx.status === 'pending';
  const isFailed = tx.isError === '1';
  const gasEth = (parseFloat(tx.gasUsed || '0') * parseFloat(tx.gasPrice || '0')) / 1e18;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1200);
  };

  return (
    <div
      className={`tx-card ${isLoading ? 'tx-card--loading' : ''} ${isFailed ? 'tx-card--failed' : ''}`}
      style={{ animationDelay: `${Math.min(index * 25, 250)}ms` }}
    >
      {/* Timeline dot */}
      <div className={`tx-timeline-dot ${viewMode === 'raw' ? 'cat-raw' : meta.className}`} />

      <div className="tx-card-inner">
        {/* Top Header Row */}
        <div className="tx-card-header">
          <div className="tx-date">
            <span className="tx-date-main">{formatDate(tx.date)}</span>
            <span className="tx-date-time">{formatTime(tx.date)}</span>
            {tx.walletLabel && (
              <span className="wallet-origin-tag" title={`Fetched for wallet ${tx.walletLabel}`}>
                Wallet: {formatAddress(tx.walletLabel)}
              </span>
            )}
          </div>

          <div className="tx-card-right">
            {viewMode === 'raw' ? (
              <span className="category-tag cat-raw">
                ⚙️ Raw Block #{tx.blockNumber}
              </span>
            ) : (
              <>
                <span className={`category-tag ${meta.className}`}>
                  {meta.icon} {meta.label}
                </span>
                {tx.confidence > 0 && tx.confidence < 0.7 && (
                  <span className="warning-badge" title="Low classification confidence — review manually">
                    ⚠️ Review
                  </span>
                )}
              </>
            )}
            {isFailed && <span className="failed-badge">Failed TX</span>}
          </div>
        </div>

        {/* Content Body: Raw Mode vs Classified Mode */}
        {viewMode === 'raw' ? (
          <div className="raw-tx-body">
            <div className="raw-tx-grid">
              <div className="raw-field">
                <span className="raw-label">Function / Method</span>
                <span className="raw-value code-font">
                  {tx.functionName || (tx.input && tx.input !== '0x' ? tx.input.slice(0, 10) : 'Standard Transfer')}
                </span>
              </div>
              <div className="raw-field">
                <span className="raw-label">Raw Value</span>
                <span className="raw-value">
                  {tx.value} wei ({weiToEth(tx.value).toFixed(6)} ETH)
                </span>
              </div>
              <div className="raw-field">
                <span className="raw-label">Gas Fee</span>
                <span className="raw-value">{gasEth.toFixed(6)} ETH</span>
              </div>
              <div className="raw-field">
                <span className="raw-label">Input Hex</span>
                <span className="raw-value code-font hash-truncated">
                  {tx.input || '0x'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Description */}
            {isLoading ? (
              <div className="tx-description skeleton-line" />
            ) : (
              <p className="tx-description">{tx.description}</p>
            )}

            {/* Values */}
            <div className="tx-values">
              <div className="tx-value-item">
                <span className="tx-value-label">ETH Amount</span>
                <span className="tx-value-amount">{tx.ethValue.toFixed(4)} ETH</span>
              </div>

              {tx.usdValue === null ? (
                <div className="tx-value-item">
                  <span className="tx-value-label">USD Value</span>
                  <span className="tx-value-amount price-pending">
                    {isLoading ? 'Fetching price…' : 'Historical lookup pending'}
                  </span>
                </div>
              ) : tx.usdValue > 0 ? (
                <div className="tx-value-item">
                  <span className="tx-value-label">USD Value</span>
                  <span className="tx-value-amount usd">{formatUsd(tx.usdValue)}</span>
                </div>
              ) : null}

              {isLoading && (
                <div className="tx-value-item">
                  <span className="skeleton-line" style={{ width: '80px', height: '16px' }} />
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer Row: Addresses & Block Explorer Link */}
        <div className="tx-footer">
          <div className="tx-addresses">
            <span className="tx-addr-label">From</span>
            <button
              className="copy-btn"
              onClick={() => handleCopy(tx.from, `from_${tx.hash}`)}
              title="Copy Sender Address"
            >
              <span className="tx-addr">{formatAddress(tx.from)}</span>
              {copiedKey === `from_${tx.hash}` && <span className="copy-toast">Copied!</span>}
            </button>

            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="tx-arrow">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>

            <span className="tx-addr-label">To</span>
            <button
              className="copy-btn"
              onClick={() => handleCopy(tx.to, `to_${tx.hash}`)}
              title="Copy Recipient Address"
            >
              <span className="tx-addr">{formatAddress(tx.to)}</span>
              {copiedKey === `to_${tx.hash}` && <span className="copy-toast">Copied!</span>}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              className="copy-btn"
              onClick={() => handleCopy(tx.hash, `hash_${tx.hash}`)}
              title="Copy Transaction Hash"
            >
              <span style={{ fontFamily: 'var(--font-mono)' }}>{tx.hash.slice(0, 8)}…</span>
              {copiedKey === `hash_${tx.hash}` && <span className="copy-toast">Copied!</span>}
            </button>

            <a
              href={`https://etherscan.io/tx/${tx.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="tx-hash-link"
              title={`View tx ${tx.hash} on Etherscan`}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>
        </div>

        {/* Confidence Indicator in Classified Mode */}
        {viewMode === 'classified' && tx.status === 'classified' && tx.confidence > 0 && (
          <div className="tx-confidence" title={`Classification confidence: ${Math.round(tx.confidence * 100)}%`}>
            <div
              className={`tx-confidence-bar ${tx.confidence < 0.7 ? 'low-confidence' : ''}`}
              style={{ width: `${tx.confidence * 100}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
