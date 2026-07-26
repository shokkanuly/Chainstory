// src/components/TransactionTimeline.tsx
import { useState } from 'react';
import type { ClassifiedTransaction, TaxCategory, TimelineViewMode } from '../types';
import TransactionCard from './TransactionCard';
import ExportButton from './ExportButton';

interface Props {
  transactions: ClassifiedTransaction[];
  walletAddress: string;
  isCapped?: boolean;
}

type FilterValue = TaxCategory | 'all';

const FILTERS: { label: string; value: FilterValue; icon: string }[] = [
  { label: 'All', value: 'all', icon: '🔍' },
  { label: 'Trades', value: 'trade', icon: '💱' },
  { label: 'Income', value: 'income', icon: '💎' },
  { label: 'Transfers', value: 'transfer', icon: '↔️' },
  { label: 'NFT Events', value: 'nft', icon: '🖼️' },
];

export default function TransactionTimeline({ transactions, walletAddress, isCapped }: Props) {
  const [activeFilter, setActiveFilter] = useState<FilterValue>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<TimelineViewMode>('classified');

  const filtered = transactions.filter(tx => {
    const matchesFilter = activeFilter === 'all' || tx.category === activeFilter;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      tx.description.toLowerCase().includes(q) ||
      tx.hash.toLowerCase().includes(q) ||
      tx.from.toLowerCase().includes(q) ||
      tx.to?.toLowerCase().includes(q) ||
      tx.functionName?.toLowerCase().includes(q) ||
      tx.input?.toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  });

  const counts = FILTERS.reduce(
    (acc, f) => {
      acc[f.value] = f.value === 'all'
        ? transactions.length
        : transactions.filter(tx => tx.category === f.value).length;
      return acc;
    },
    {} as Record<FilterValue, number>
  );

  return (
    <div className="timeline-section">
      {/* Header Bar */}
      <div className="timeline-header-row">
        <div className="timeline-title-area">
          <h2 className="timeline-title">Transaction History Timeline</h2>
          <span className="timeline-subtitle">
            Chronological wallet activity log
          </span>
        </div>

        <div className="timeline-action-group">
          {/* Raw Data vs Classified View Toggle */}
          <div className="view-mode-toggle">
            <button
              className={`view-mode-btn ${viewMode === 'classified' ? 'active' : ''}`}
              onClick={() => setViewMode('classified')}
              title="View plain-English AI descriptions and tax categories"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
              AI Timeline
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'raw' ? 'active' : ''}`}
              onClick={() => setViewMode('raw')}
              title="View raw unclassified blockchain data fields"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
              Raw Pipeline Data
            </button>
          </div>

          <ExportButton transactions={transactions} walletAddress={walletAddress} />
        </div>
      </div>

      {/* Control Bar: Filters & Search */}
      <div className="timeline-controls">
        <div className="filter-tabs">
          {FILTERS.map(f => (
            <button
              key={f.value}
              id={`filter-${f.value}`}
              className={`filter-tab ${activeFilter === f.value ? 'active' : ''}`}
              onClick={() => setActiveFilter(f.value)}
            >
              <span className="filter-tab-icon">{f.icon}</span>
              {f.label}
              <span className="filter-tab-count">{counts[f.value] || 0}</span>
            </button>
          ))}
        </div>

        <div className="timeline-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            id="timeline-search"
            type="text"
            placeholder="Search hash, address, method..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="search-input"
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>
      </div>

      {isCapped && (
        <div className="timeline-capped-note">
          ℹ️ Displaying recent transactions (capped at 100).
        </div>
      )}

      {/* Transaction Scrollable List */}
      <div className="timeline-list">
        {filtered.length === 0 ? (
          <div className="timeline-empty">
            <div className="timeline-empty-icon">🔎</div>
            <h3>No matching transactions</h3>
            <p>Try adjusting your category filter or search query.</p>
          </div>
        ) : (
          filtered.map((tx, i) => (
            <TransactionCard
              key={tx.hash}
              tx={tx}
              index={i}
              viewMode={viewMode}
            />
          ))
        )}
      </div>

      {filtered.length > 0 && (
        <div className="timeline-footer">
          Showing {filtered.length} of {transactions.length} fetched transactions
        </div>
      )}
    </div>
  );
}
