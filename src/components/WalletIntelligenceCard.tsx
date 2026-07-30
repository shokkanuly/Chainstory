// src/components/WalletIntelligenceCard.tsx
// Compact, tool-first Wallet Intelligence Summary Card

import { analyzeWalletIntelligence, type WalletIntelligenceReport } from '../services/walletIntelligence';
import type { ClassifiedTransaction } from '../types';

interface Props {
  transactions: ClassifiedTransaction[];
  walletAddress: string;
}

function formatAge(days: number): string {
  if (days < 30) return `${days} days old`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? 's' : ''} old`;
  const years = (days / 365).toFixed(1);
  return `${years} years old`;
}

function formatDateShort(date: Date | null): string {
  if (!date) return 'N/A';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function WalletIntelligenceCard({ transactions, walletAddress }: Props) {
  const intel: WalletIntelligenceReport = analyzeWalletIntelligence(transactions, walletAddress);

  if (transactions.length === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md p-5 shadow-xl space-y-4 mb-6">
      
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-lg">
            🧠
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white tracking-tight">Wallet Intelligence Summary</h3>
              <span className="text-[10px] font-semibold tracking-wide uppercase bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2 py-0.5 rounded-full">
                {intel.reputationLabel}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{intel.reputationDescription}</p>
          </div>
        </div>

        {/* Risk Flag Badge */}
        <div>
          {intel.riskStatus === 'clean' ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>No Flagged Interactions</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>{intel.flaggedInteractions.length} Flagged Interaction(s) Found</span>
            </div>
          )}
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        
        {/* Metric 1: Wallet Age */}
        <div className="p-3 bg-slate-800/40 border border-slate-700/30 rounded-xl space-y-1">
          <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Wallet Age</span>
          <div className="text-sm font-bold text-white">{formatAge(intel.walletAgeDays)}</div>
          <div className="text-[10px] text-slate-500">First: {formatDateShort(intel.firstTxDate)}</div>
        </div>

        {/* Metric 2: Activity Diversity */}
        <div className="p-3 bg-slate-800/40 border border-slate-700/30 rounded-xl space-y-1">
          <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Contract Diversity</span>
          <div className="text-sm font-bold text-indigo-300">{intel.distinctProtocolsCount} Protocols</div>
          <div className="text-[10px] text-slate-500">Across {intel.totalTransactions} transactions</div>
        </div>

        {/* Metric 3: Latest Activity */}
        <div className="p-3 bg-slate-800/40 border border-slate-700/30 rounded-xl space-y-1">
          <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Latest Activity</span>
          <div className="text-sm font-bold text-white">{formatDateShort(intel.latestTxDate)}</div>
          <div className="text-[10px] text-slate-500">Most recent transaction</div>
        </div>

        {/* Metric 4: Risk Assessment */}
        <div className="p-3 bg-slate-800/40 border border-slate-700/30 rounded-xl space-y-1">
          <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Risk Level</span>
          <div className={`text-sm font-bold capitalize ${intel.riskStatus === 'clean' ? 'text-emerald-400' : 'text-amber-400'}`}>
            {intel.riskStatus === 'clean' ? 'Low Risk' : 'Caution Advised'}
          </div>
          <div className="text-[10px] text-slate-500">
            {intel.flaggedInteractions.length === 0 ? 'Clean history' : `${intel.flaggedInteractions[0]?.name}`}
          </div>
        </div>

      </div>

      {/* Flagged interactions warning detail (if any) */}
      {intel.flaggedInteractions.length > 0 && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs space-y-1 text-amber-300">
          <div className="font-semibold flex items-center gap-1.5">
            <span>⚠️ Counterparty Risk Warning</span>
          </div>
          <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-200/90">
            {intel.flaggedInteractions.map((f, i) => (
              <li key={i}>
                Interaction with <strong>{f.name}</strong> ({f.riskType}) on {formatDateShort(f.date)}
              </li>
            ))}
          </ul>
        </div>
      )}

    </div>
  );
}
