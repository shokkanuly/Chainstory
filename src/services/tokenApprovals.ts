// src/services/tokenApprovals.ts
//
// Collapse a transaction history into the ERC-20 allowances still outstanding.
//
// An approval is identified by the (token contract, spender) pair: later
// approve() calls on the same pair replace earlier ones, and approve(spender, 0)
// revokes. Listing every historical approve() call — as this used to — reports
// permissions the user has already taken back.
//
// Kept out of the component file so that file only exports a component, which
// keeps React Fast Refresh working.

import type { ClassifiedTransaction } from '../types';
import { decodeApproval } from './abiDecoder';
import { scaleTokenAmount } from './assetResolver';

export interface DecodedApproval {
  txHash: string;
  /** The contract allowed to spend — decoded from calldata, not tx.to. */
  spender: string;
  /** The ERC-20 contract the allowance is against — this is tx.to. */
  tokenContract: string;
  tokenSymbol: string;
  tokenName: string;
  isUnlimited: boolean;
  amountText: string;
  date: Date;
}

function formatAllowance(amount: bigint, decimals: string | undefined): string {
  const scaled = scaleTokenAmount(amount.toString(), decimals);
  if (scaled === 0) return '0';
  if (scaled < 0.0001) return '<0.0001';
  if (scaled >= 1_000_000) return `${(scaled / 1_000_000).toFixed(2)}M`;
  if (scaled >= 1_000) return `${(scaled / 1_000).toFixed(2)}K`;
  return scaled.toFixed(4);
}

/**
 * Collapse a transaction history into the allowances still outstanding.
 * Only approvals sent BY the wallet count — an approve() the wallet merely
 * appears in grants nothing on its behalf.
 */
export function extractApprovalsFromTransactions(
  transactions: ClassifiedTransaction[],
  walletAddress: string
): DecodedApproval[] {
  const owner = (walletAddress || '').toLowerCase();

  // Latest approve() wins per (token, spender) pair.
  const latestByPair = new Map<string, { tx: ClassifiedTransaction; decoded: ReturnType<typeof decodeApproval> }>();

  const chronological = [...transactions].sort((a, b) => a.date.getTime() - b.date.getTime());

  for (const tx of chronological) {
    if ((tx.from || '').toLowerCase() !== owner) continue;

    const decoded = decodeApproval(tx.input);
    if (!decoded) continue;

    const tokenContract = (tx.to || tx.contractAddress || '').toLowerCase();
    if (!tokenContract) continue;

    latestByPair.set(`${tokenContract}:${decoded.spender}`, { tx, decoded });
  }

  const approvals: DecodedApproval[] = [];

  for (const { tx, decoded } of latestByPair.values()) {
    if (!decoded || decoded.isRevocation) continue; // already revoked — not outstanding

    approvals.push({
      txHash: tx.hash,
      spender: decoded.spender,
      tokenContract: tx.to || tx.contractAddress || '',
      tokenSymbol: tx.tokenSymbol || 'ERC-20 Token',
      tokenName: tx.tokenName || tx.to || 'Token',
      isUnlimited: decoded.isUnlimited,
      amountText: decoded.isUnlimited
        ? 'Unlimited Allowance'
        : `${formatAllowance(decoded.amount, tx.tokenDecimal)} ${tx.tokenSymbol || 'units'}`,
      date: tx.date,
    });
  }

  return approvals.sort((a, b) => b.date.getTime() - a.date.getTime());
}
