// src/components/TransactionCard.tsx — Premium Transaction Card
import type { ClassifiedTransaction, TaxCategory } from '../types';
import { formatAddress } from '../services/etherscan';
import { explorerTxUrl } from '../services/chains';
import { CATEGORY_ICON, InlineIcon } from './icons';
import { forwardRef, useRef, type CSSProperties } from 'react';
import { motion, useInView } from 'framer-motion';
import { EASE, useReducedMotion } from '../lib/motion';
import DecodeText from './motion/DecodeText';

interface Props {
  tx: ClassifiedTransaction;
  index: number;
}

const CATEGORY_META: Record<TaxCategory | 'unknown', { label: string; className: string; color: string }> = {
  trade: { label: 'Trade', className: 'cat-trade', color: 'var(--cat-trade)' },
  income: { label: 'Income', className: 'cat-income', color: 'var(--cat-income)' },
  transfer: { label: 'Transfer', className: 'cat-transfer', color: 'var(--b-purple)' },
  nft: { label: 'NFT', className: 'cat-nft', color: 'var(--cat-nft)' },
  unknown: { label: 'Unknown', className: 'cat-unknown', color: 'var(--b-purple)' },
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

// Forwarded so the timeline's AnimatePresence can measure a card as it leaves.
const TransactionCard = forwardRef<HTMLDivElement, Props>(function TransactionCard({ tx, index }, forwarded) {
  const reduce = useReducedMotion();
  const local = useRef<HTMLDivElement>(null);
  const inView = useInView(local, { once: true, amount: 0.25 });
  const meta = CATEGORY_META[tx.category];
  const isLoading = tx.status === 'classifying' || tx.status === 'pending';
  const isFailed = tx.isError === '1';
  // Sequence: a feed is an ordered history, so the first screenful arrives in
  // order. Rows scrolled to later arrive at once, never waiting on the queue.
  const delay = reduce ? 0 : index < 8 ? index * 0.06 : 0;

  return (
    <motion.div
      ref={(el) => {
        local.current = el;
        if (typeof forwarded === 'function') forwarded(el);
        else if (forwarded) forwarded.current = el;
      }}
      layout={reduce ? false : 'position'}
      // Each row rises out of the page and a line of light crosses it: the
      // chain being read, one transaction at a time.
      initial={reduce ? false : { opacity: 0, y: 28, rotateX: -18, scale: 0.98 }}
      animate={inView ? { opacity: 1, y: 0, rotateX: 0, scale: 1 } : undefined}
      exit={reduce ? undefined : { opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ duration: 0.7, ease: EASE, delay }}
      style={{ transformPerspective: 1000, transformOrigin: '50% 0%', ['--scan' as string]: meta.color } as CSSProperties}
      data-scan={inView && !reduce ? 'on' : undefined}
      className={`tx-card fx-scan ${isLoading ? 'tx-card--loading' : ''} ${isFailed ? 'tx-card--failed' : ''}`}
    >
      <div className="tx-card-inner fx-spot" style={{ ['--spot' as string]: meta.color } as CSSProperties}>
        {/* Header: date + category */}
        <div className="tx-card-header">
          <div className="tx-date">
            <span className="tx-date-main">{formatDate(tx.date)}</span>
            <span className="tx-date-time">{formatTime(tx.date)}</span>
          </div>
          <div className="tx-card-right">
            <span className={`category-tag ${meta.className}`}>
              <InlineIcon icon={CATEGORY_ICON[tx.category]} size={13} />
              {meta.label}
            </span>
            {isFailed && <span className="failed-badge">Failed</span>}
          </div>
        </div>

        {/* Description */}
        {/* The story decodes from hex as the row arrives, or as its
            classification lands while you watch. */}
        {isLoading ? (
          <div className="skeleton-line" />
        ) : (
          <DecodeText as="p" className="tx-description" text={tx.description} play={inView} delay={delay * 1000 + 180} duration={750} />
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
            href={explorerTxUrl(tx.hash, tx.chainId)}
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
    </motion.div>
  );
});

export default TransactionCard;
