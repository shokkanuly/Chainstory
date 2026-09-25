// src/services/walletIntelligence.ts
//
// Wallet Intelligence Analysis Engine.
// Computes wallet age, protocol activity diversity, reputation classification,
// and screens counterparty addresses against known risk/sanctions lists.

import type { ClassifiedTransaction } from '../types';

export interface FlaggedInteraction {
  txHash: string;
  address: string;
  name: string;
  riskType: 'mixer' | 'phishing' | 'sanctioned' | 'exploit';
  date: Date;
}

export interface WalletIntelligenceReport {
  walletAddress: string;
  firstTxDate: Date | null;
  latestTxDate: Date | null;
  walletAgeDays: number;
  totalTransactions: number;
  distinctProtocolsCount: number;
  distinctProtocolNames: string[];
  reputationLabel: string;
  reputationDescription: string;
  flaggedInteractions: FlaggedInteraction[];
  riskStatus: 'clean' | 'warning' | 'high_risk';
}

// Curated public database of known flagged/mixer/sanctioned addresses
const FLAGGED_ADDRESSES_DATABASE: Record<
  string,
  { name: string; riskType: 'mixer' | 'phishing' | 'sanctioned' | 'exploit' }
> = {
  // Tornado Cash Contracts & Routers
  '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b': { name: 'Tornado Cash Router', riskType: 'mixer' },
  '0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc': { name: 'Tornado Cash 0.1 ETH', riskType: 'mixer' },
  '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936': { name: 'Tornado Cash 1 ETH', riskType: 'mixer' },
  '0x910cbd523d972eb0a6f4cae4618ad62622b39dbf': { name: 'Tornado Cash 10 ETH', riskType: 'mixer' },
  '0xa160adc22234005087092d8492383c08728bc7a6': { name: 'Tornado Cash 100 ETH', riskType: 'mixer' },
  '0x08370852993d5516086fcfd51fb15494d4d80a15': { name: 'Tornado Cash Nova', riskType: 'mixer' },
  
  // Known Sanctioned / Exploiter Addresses
  '0x098b716b8aaf21512996dc57eb0615e2383e2f96': { name: 'Ronin Bridge Exploiter (Lazarus)', riskType: 'sanctioned' },
  '0x19273b57da86154d6d44368d69803b8f37a02d6f': { name: 'OFAC Sanctioned Address', riskType: 'sanctioned' },
  '0x3cce4400f62355745851b8e7bfb5808b496a310a': { name: 'FixedFloat Hack Drainer', riskType: 'exploit' },
  '0x000000000000000000000000000000000000dead': { name: 'Burn Address / Dead Null', riskType: 'phishing' },
};

export function analyzeWalletIntelligence(
  transactions: ClassifiedTransaction[],
  walletAddress: string
): WalletIntelligenceReport {
  if (!transactions || transactions.length === 0) {
    return {
      walletAddress,
      firstTxDate: null,
      latestTxDate: null,
      walletAgeDays: 0,
      totalTransactions: 0,
      distinctProtocolsCount: 0,
      distinctProtocolNames: [],
      reputationLabel: 'New Wallet',
      reputationDescription: 'No transaction history detected on this network.',
      flaggedInteractions: [],
      riskStatus: 'clean',
    };
  }

  // 1. Sort transactions by timestamp
  const sorted = [...transactions].sort((a, b) => a.date.getTime() - b.date.getTime());
  const firstTxDate = sorted[0].date;
  const latestTxDate = sorted[sorted.length - 1].date;

  const now = new Date();
  const walletAgeDays = Math.max(
    1,
    Math.floor((now.getTime() - firstTxDate.getTime()) / (1000 * 60 * 60 * 24))
  );

  // 2. Extract distinct protocol interactions
  const protocolSet = new Set<string>();
  for (const tx of transactions) {
    if (tx.tokenName) protocolSet.add(tx.tokenName);
    if (tx.functionName) {
      const cleanFn = tx.functionName.split('(')[0];
      if (cleanFn && cleanFn !== 'transfer') protocolSet.add(cleanFn);
    }
  }

  const distinctProtocolNames = Array.from(protocolSet).slice(0, 10);
  const distinctProtocolsCount = protocolSet.size;

  // 3. Transparent Heuristic Reputation Summary
  let reputationLabel = 'Regular Active Wallet';
  let reputationDescription = 'Standard transaction frequency and contract usage.';

  if (walletAgeDays > 730 && transactions.length > 50) {
    reputationLabel = 'Established Veteran';
    reputationDescription = `Active for ${Math.floor(walletAgeDays / 365)} years across ${distinctProtocolsCount} distinct contract interactions.`;
  } else if (distinctProtocolsCount >= 5 || transactions.length > 30) {
    reputationLabel = 'DeFi Explorer';
    reputationDescription = `Diverse protocol interactions across ${distinctProtocolsCount} distinct contracts.`;
  } else if (walletAgeDays < 30) {
    reputationLabel = 'Newly Created Wallet';
    reputationDescription = `First active ${walletAgeDays} day(s) ago. Limited historical track record.`;
  }

  // 4. Counterparty Risk & Sanctions Screening
  const flaggedInteractions: FlaggedInteraction[] = [];
  const targetWalletLower = walletAddress.toLowerCase();

  for (const tx of transactions) {
    const counterparties = [tx.from, tx.to, tx.contractAddress].filter(Boolean) as string[];

    for (const addr of counterparties) {
      const addrLower = addr.toLowerCase();
      if (addrLower === targetWalletLower) continue;

      const flaggedInfo = FLAGGED_ADDRESSES_DATABASE[addrLower];
      if (flaggedInfo) {
        flaggedInteractions.push({
          txHash: tx.hash,
          address: addr,
          name: flaggedInfo.name,
          riskType: flaggedInfo.riskType,
          date: tx.date,
        });
      }
    }
  }

  const riskStatus =
    flaggedInteractions.length > 0
      ? flaggedInteractions.some((f) => f.riskType === 'sanctioned' || f.riskType === 'exploit')
        ? 'high_risk'
        : 'warning'
      : 'clean';

  return {
    walletAddress,
    firstTxDate,
    latestTxDate,
    walletAgeDays,
    totalTransactions: transactions.length,
    distinctProtocolsCount,
    distinctProtocolNames,
    reputationLabel,
    reputationDescription,
    flaggedInteractions,
    riskStatus,
  };
}
