// src/components/TransactionTimeline.tsx — Premium Transaction Explorer
import { useState } from 'react';
import type { ClassifiedTransaction, TaxCategory } from '../types';
import TransactionCard from './TransactionCard';
import ExportButton from './ExportButton';

interface Props {
  transactions: ClassifiedTransaction[];
  walletAddress: string;
  isCapped?: boolean;
}

type FilterValue = TaxCategory | 'all';

const FILTERS: { label: string; value: FilterValue; icon: string }[] = [
  { label: 'All', value: 'all', icon: '⬡' },
  { label: 'Trades', value: 'trade', icon: '💱' },
  { label: 'Income', value: 'income', icon: '💎' },
  { label: 'Transfers', value: 'transfer', icon: '↔️' },
  { label: 'NFT', value: 'nft', icon: '🖼️' },
];

export default function TransactionTimeline({ transactions, walletAddress, isCapped }: Props) {
  const [activeFilter, setActiveFilter] = useState<FilterValue>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = transactions.filter(tx => {
    const matchesFilter = activeFilter === 'all' || tx.category === activeFilter;
    const matchesSearch =
      !searchQuery ||
      tx.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.hash.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.from.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.to?.toLowerCase().includes(searchQuery.toLowerCase());
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
      {/* Header */}
      <div className="timeline-header-row">
        <div className="flex items-center gap-3">
          <h2 className="timeline-title">Transaction Explorer</h2>
          <span className="text-[11px] font-medium text-muted-foreground bg-secondary/60 px-2.5 py-1 rounded-md">
            {transactions.length} txns
          </span>
        </div>
        <ExportButton transactions={transactions} walletAddress={walletAddress} />
      </div>

      {/* Filters + Search */}
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
            placeholder="Search transactions…"
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
          ℹ️ Showing your 100 most recent transactions.
        </div>
      )}

      {/* Cards */}
      <div className="timeline-list">
        {filtered.length === 0 ? (
          <div className="timeline-empty">
            <div className="timeline-empty-icon">🔎</div>
            <p className="text-sm text-muted-foreground">No transactions match your filter.</p>
          </div>
        ) : (
          filtered.map((tx, i) => (
            <TransactionCard key={tx.hash} tx={tx} index={i} />
          ))
        )}
      </div>

      {filtered.length > 0 && (
        <div className="timeline-footer">
          Showing {filtered.length} of {transactions.length} transactions
        </div>
      )}
    </div>
  );
}
