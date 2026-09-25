// src/services/contractRiskExplainer.ts
//
// Plain-English explanation of what a contract's owner can do to you after
// you approve it: upgrade the code, pause transfers, mint supply.
//
// Previously this returned real analysis for exactly two hardcoded addresses
// and a generic "unverified" answer for everything else. It now reads the
// verified ABI and the EIP-1967 proxy flag from the explorer, and reports
// 'unknown' — not 'low risk' — when it cannot determine an answer.

import type { ChainId } from '../types';
import { fetchContractIntel, isAddressShaped, type ContractIntel } from './contractIntel';

export type ProxyType =
  | 'Upgradeable Proxy'
  | 'Direct Immutable Contract'
  | 'Externally Owned Account'
  | 'Unknown / Unverified';

export interface ContractPermissionRisk {
  contractAddress: string;
  contractName: string | null;
  isProxy: boolean | null;
  proxyType: ProxyType;
  implementationAddress: string | null;
  hasAdminKey: boolean | null;
  canUpgradeCode: boolean | null;
  canPauseTransfers: boolean | null;
  canMintTokens: boolean | null;
  /** Function names from the ABI that justify the flags above. */
  evidence: string[];
  plainEnglishExplanation: string;
  riskSeverity: 'low' | 'medium' | 'high' | 'unknown';
  intel: ContractIntel | null;
}

function unknownResult(address: string, reason: string): ContractPermissionRisk {
  // Reasons arrive with and without terminal punctuation; normalise so the
  // sentences below always join cleanly.
  const sentence = /[.!?]$/.test(reason.trim()) ? reason.trim() : `${reason.trim()}.`;
  return {
    contractAddress: address,
    contractName: null,
    isProxy: null,
    proxyType: 'Unknown / Unverified',
    implementationAddress: null,
    hasAdminKey: null,
    canUpgradeCode: null,
    canPauseTransfers: null,
    canMintTokens: null,
    evidence: [],
    plainEnglishExplanation:
      `PERMISSIONS UNKNOWN: ${sentence} Nothing here should be read as a clean result — ` +
      'avoid granting unlimited allowances to a contract you cannot inspect.',
    riskSeverity: 'unknown',
    intel: null,
  };
}

export async function explainContractPermissionRisk(
  contractInput: string,
  chainId: ChainId = 'ethereum'
): Promise<ContractPermissionRisk> {
  const clean = (contractInput || '').trim();

  if (!isAddressShaped(clean)) {
    return unknownResult(clean, 'That is not a valid 42-character EVM address.');
  }

  const intel = await fetchContractIntel(clean, chainId);

  if (intel.status === 'unavailable') {
    return {
      ...unknownResult(clean, intel.unavailableReason ?? 'The explorer was unreachable.'),
      intel,
    };
  }

  if (intel.isContract === false) {
    return {
      contractAddress: clean,
      contractName: null,
      isProxy: false,
      proxyType: 'Externally Owned Account',
      implementationAddress: null,
      hasAdminKey: false,
      canUpgradeCode: false,
      canPauseTransfers: false,
      canMintTokens: false,
      evidence: [],
      plainEnglishExplanation:
        'WALLET ADDRESS: There is no contract code at this address, so there are no contract ' +
        'permissions to grant. Sending here transfers directly to whoever holds the private key.',
      riskSeverity: 'low',
      intel,
    };
  }

  if (intel.isVerified === false) {
    return {
      contractAddress: clean,
      contractName: intel.contractName,
      isProxy: intel.isProxy,
      proxyType: intel.isProxy ? 'Upgradeable Proxy' : 'Unknown / Unverified',
      implementationAddress: intel.implementationAddress,
      hasAdminKey: null,
      canUpgradeCode: intel.isProxy,
      canPauseTransfers: null,
      canMintTokens: null,
      evidence: [],
      plainEnglishExplanation:
        'UNVERIFIED CONTRACT: The source code behind this address has not been published to the ' +
        'block explorer, so its admin powers cannot be inspected. It may be able to upgrade itself, ' +
        'pause transfers, or mint supply — there is no way to tell. Avoid unlimited approvals.',
      riskSeverity: 'high',
      intel,
    };
  }

  const caps = intel.adminCapabilities;
  const canUpgradeCode = Boolean(intel.isProxy || caps?.canUpgrade);
  const canPauseTransfers = caps?.canPause ?? null;
  const canMintTokens = caps?.canMint ?? null;
  const hasAdminKey = caps?.hasOwner ?? null;

  const powers: string[] = [];
  if (canUpgradeCode) powers.push('replace its own code');
  if (canPauseTransfers) powers.push('pause transfers');
  if (canMintTokens) powers.push('mint new supply');

  let riskSeverity: ContractPermissionRisk['riskSeverity'] = 'low';
  if (canUpgradeCode) riskSeverity = 'high';
  else if (canPauseTransfers || canMintTokens) riskSeverity = 'medium';
  else if (hasAdminKey) riskSeverity = 'medium';

  const name = intel.contractName ? `"${intel.contractName}"` : 'This contract';
  const ageClause = intel.ageDays !== null ? `, deployed ${intel.ageDays} day(s) ago` : '';

  const plainEnglishExplanation =
    powers.length === 0
      ? `${name} is verified${ageClause}. Its published ABI exposes no upgrade, pause or mint ` +
        `function${hasAdminKey ? ', though it does have an owner role' : ''}. Approved funds can ` +
        'only be spent according to the parameters you pass — this is a code reading, not an audit.'
      : `${name} is verified${ageClause}, and its owner can ${powers.join(', ')}. ` +
        (canUpgradeCode
          ? 'Because the code can be replaced, what this contract does today is not a guarantee of ' +
            'what it will do tomorrow. '
          : '') +
        'Grant only the allowance you need, not an unlimited one.';

  return {
    contractAddress: clean,
    contractName: intel.contractName,
    isProxy: intel.isProxy,
    proxyType: intel.isProxy ? 'Upgradeable Proxy' : 'Direct Immutable Contract',
    implementationAddress: intel.implementationAddress,
    hasAdminKey,
    canUpgradeCode,
    canPauseTransfers,
    canMintTokens,
    evidence: caps?.evidence ?? [],
    plainEnglishExplanation,
    riskSeverity,
    intel,
  };
}
