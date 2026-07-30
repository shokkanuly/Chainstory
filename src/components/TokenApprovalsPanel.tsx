// src/components/TokenApprovalsPanel.tsx
//
// Read-only Token Approvals Panel (#2)
// Identifies and surfaces token approval transactions in plain English.
// Flags unlimited approvals for user security awareness.

import type { ClassifiedTransaction } from '../types';
import { formatAddress } from '../services/etherscan';

interface Props {
  transactions: ClassifiedTransaction[];
  walletAddress: string;
}

export interface DecodedApproval {
  txHash: string;
  spender: string;
  tokenSymbol: string;
  tokenName: string;
  isUnlimited: boolean;
  amountText: string;
  date: Date;
}

export function extractApprovalsFromTransactions(
  transactions: ClassifiedTransaction[]
): DecodedApproval[] {
  const approvals: DecodedApproval[] = [];

  for (const tx of transactions) {
    const inputHex = (tx.input || '').toLowerCase();
    const isApproveSelector = inputHex.startsWith('0x095ea7b3');
    const isApproveFn = (tx.functionName || '').toLowerCase().includes('approve');

    if (isApproveSelector || isApproveFn) {
      const spender = tx.to || tx.contractAddress || 'Unknown Spender Contract';
      const tokenSymbol = tx.tokenSymbol || 'ERC-20 Token';
      const tokenName = tx.tokenName || tx.contractAddress || 'Token';

      // Check if input parameter has max uint256 / large hex for unlimited allowance
      const rawParams = inputHex.slice(10);
      const isUnlimited =
        rawParams.includes('ffffffffffffffffffffffffffffffff') ||
        rawParams.includes('f'.repeat(32)) ||
        tx.description.toLowerCase().includes('unlimited') ||
        tx.description.toLowerCase().includes('authorize');

      approvals.push({
        txHash: tx.hash,
        spender,
        tokenSymbol,
        tokenName,
        isUnlimited,
        amountText: isUnlimited ? 'Unlimited Allowance' : 'Specific Limit',
        date: tx.date,
      });
    }
  }

  return approvals;
}

export default function TokenApprovalsPanel({ transactions }: Props) {
  const approvals = extractApprovalsFromTransactions(transactions);

  if (approvals.length === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md p-5 shadow-xl space-y-4 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🔑</span>
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight">Token Approvals History</h3>
            <p className="text-xs text-slate-400">
              Read-only view of ERC-20 spending permissions granted by this wallet.
            </p>
          </div>
        </div>

        <span className="text-xs font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2.5 py-1 rounded-full">
          {approvals.length} Approval{approvals.length > 1 ? 's' : ''} Found
        </span>
      </div>

      {/* Approvals List */}
      <div className="space-y-2.5">
        {approvals.map((app, idx) => (
          <div
            key={idx}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-800/40 border border-slate-700/30 rounded-xl text-xs"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-medium text-white">
                <span>Granted permission for</span>
                <span className="font-bold text-indigo-400">{app.tokenSymbol}</span>
              </div>
              <div className="text-slate-400 font-mono text-[11px]">
                Spender Contract: <span className="text-slate-300">{formatAddress(app.spender)}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {app.isUnlimited ? (
                <span className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-1 rounded-lg font-bold text-[11px]">
                  ⚠️ Unlimited Approval
                </span>
              ) : (
                <span className="bg-slate-700/50 text-slate-300 px-2.5 py-1 rounded-lg text-[11px]">
                  Limited Approval
                </span>
              )}
              <span className="text-slate-500 text-[11px]">
                {app.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Boundary & Awareness Disclaimer */}
      <div className="text-[11px] text-slate-500 bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/60 leading-relaxed">
        <strong>Notice:</strong> This panel surfaces token approvals recorded in the wallet's historical transaction log for awareness. It is a read-only informational view and does not revoke permissions or execute blockchain transactions.
      </div>
    </div>
  );
}
