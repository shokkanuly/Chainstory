// src/chains/solana/risk.ts
// Solana Security Audits: Delegated Authority & Program Upgrade Authority Checks

import type { PermissionFinding, ContractRiskReport } from '../types';
import type { Address } from '../../domain';

export interface SplTokenAccountInfo {
  pubkey: string;
  mint: string;
  owner: string;
  amount: bigint;
  delegate?: string | null;
  delegatedAmount?: bigint;
}

export function auditSplDelegates(
  accounts: SplTokenAccountInfo[]
): PermissionFinding[] {
  const findings: PermissionFinding[] = [];

  for (const acc of accounts) {
    if (acc.delegate && acc.delegatedAmount && acc.delegatedAmount > 0n) {
      const isUnlimited = acc.delegatedAmount >= acc.amount;
      findings.push({
        id: `delegate_${acc.pubkey}_${acc.delegate}`,
        asset: acc.mint,
        spenderOrDelegate: acc.delegate,
        allowanceOrAmount: acc.delegatedAmount.toString(),
        isUnlimited,
        severity: isUnlimited ? 'high' : 'medium',
        details: isUnlimited
          ? 'Delegate has permission to transfer full token balance'
          : `Delegate authorized for ${acc.delegatedAmount} tokens`,
      });
    }
  }

  return findings;
}

export interface SolanaProgramInfo {
  programId: Address;
  programDataAddress?: Address;
  upgradeAuthority: Address | null;
}

export function assessProgramUpgradeRisk(info: SolanaProgramInfo): ContractRiskReport {
  const flags: string[] = [];
  const explanations: string[] = [];

  const isMutable = info.upgradeAuthority !== null;

  if (isMutable) {
    flags.push('upgradeable_program');
    explanations.push(
      `Program is upgradeable by authority key: ${info.upgradeAuthority}. Program code can be modified.`
    );
  } else {
    explanations.push('Program is immutable (upgrade authority is renounced / null).');
  }

  return {
    target: info.programId,
    isContract: true,
    upgradeAuthority: info.upgradeAuthority,
    riskLevel: isMutable ? 'medium' : 'low',
    flags,
    explanations,
  };
}
