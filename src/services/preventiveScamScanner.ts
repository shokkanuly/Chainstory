// src/services/preventiveScamScanner.ts
//
// Pre-interaction token risk assessment.
//
// Every judgement here is derived from a fact fetched via contractIntel, or
// from the curated flag list. When the explorer cannot be reached the verdict
// is 'unknown' — the scanner does not guess, because a fabricated "safe"
// verdict on a malicious contract is the worst output this tool could give.

import type { ChainId } from '../types';
import { fetchContractIntel, isAddressShaped, type ContractIntel } from './contractIntel';

export type RiskRecommendation = 'safe' | 'caution' | 'high_risk' | 'unknown';

export interface TokenRiskAnalysis {
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  /** null when verification could not be established. */
  isVerified: boolean | null;
  /** null when the deployment date could not be established. */
  contractAgeDays: number | null;
  /** 0 (safe) to 100 (critical), or null when we could not assess. */
  riskScore: number | null;
  warnings: string[];
  recommendation: RiskRecommendation;
  plainEnglishSummary: string;
  /** The raw facts behind the verdict, so the UI can show its working. */
  intel: ContractIntel | null;
}

// Curated list of addresses known to be malicious. Small and static by design;
// absence from this list is not evidence of safety.
const KNOWN_MALICIOUS: Record<string, { symbol: string; name: string; summary: string }> = {
  '0x000000000000000000000000000000000000bad1': {
    symbol: 'FAKE-USDC',
    name: 'Fake USD Coin (Phishing)',
    summary:
      'CRITICAL RISK: This address is on our known-phishing list as a spoofed imitation of USDC. Do not swap or approve funds.',
  },
};

export async function analyzePreventiveTokenRisk(
  tokenInput: string,
  chainId: ChainId = 'ethereum'
): Promise<TokenRiskAnalysis> {
  const clean = (tokenInput || '').trim();

  if (!isAddressShaped(clean)) {
    return {
      tokenAddress: clean,
      tokenSymbol: 'INVALID',
      tokenName: 'Invalid Contract Address',
      isVerified: null,
      contractAgeDays: null,
      riskScore: null,
      warnings: ['Invalid Ethereum address format'],
      recommendation: 'unknown',
      plainEnglishSummary:
        'That is not a valid address. An EVM address is 42 characters: "0x" followed by 40 hexadecimal digits.',
      intel: null,
    };
  }

  const known = KNOWN_MALICIOUS[clean.toLowerCase()];
  if (known) {
    return {
      tokenAddress: clean,
      tokenSymbol: known.symbol,
      tokenName: known.name,
      isVerified: false,
      contractAgeDays: null,
      riskScore: 95,
      warnings: ['Address appears on a known-phishing list'],
      recommendation: 'high_risk',
      plainEnglishSummary: known.summary,
      intel: null,
    };
  }

  const intel = await fetchContractIntel(clean, chainId);

  // Could not check — say so instead of inventing a verdict.
  if (intel.status === 'unavailable') {
    return {
      tokenAddress: clean,
      tokenSymbol: 'UNKNOWN',
      tokenName: 'Unchecked Contract',
      isVerified: null,
      contractAgeDays: null,
      riskScore: null,
      warnings: [intel.unavailableReason ?? 'Contract could not be checked'],
      recommendation: 'unknown',
      plainEnglishSummary:
        `This contract could not be checked — ${intel.unavailableReason ?? 'the explorer was unreachable'}. ` +
        'Treat it as unverified — do not read this as a clean result.',
      intel,
    };
  }

  if (intel.isContract === false) {
    return {
      tokenAddress: clean,
      tokenSymbol: 'EOA',
      tokenName: 'Externally Owned Account',
      isVerified: null,
      contractAgeDays: null,
      riskScore: null,
      warnings: ['Address holds no contract code'],
      recommendation: 'unknown',
      plainEnglishSummary:
        'This address is a wallet, not a token contract. There is no code here to assess.',
      intel,
    };
  }

  // Score from real signals only.
  const warnings: string[] = [];
  let riskScore = 10;

  if (intel.isVerified === false) {
    warnings.push('Source code is not verified on the block explorer');
    riskScore += 45;
  }

  if (intel.ageDays !== null && intel.ageDays < 30) {
    warnings.push(`Contract was deployed only ${intel.ageDays} day(s) ago`);
    riskScore += 30;
  } else if (intel.ageDays === null) {
    warnings.push('Deployment date could not be determined');
    riskScore += 10;
  }

  if (intel.isProxy) {
    warnings.push('Upgradeable proxy — the code behind this address can be replaced');
    riskScore += 15;
  }

  const caps = intel.adminCapabilities;
  if (caps?.canMint) {
    warnings.push('Contract exposes a mint function — supply can be increased');
    riskScore += 10;
  }
  if (caps?.canPause) {
    warnings.push('Contract exposes a pause function — transfers can be frozen');
    riskScore += 10;
  }

  riskScore = Math.min(100, riskScore);

  const recommendation: RiskRecommendation =
    riskScore >= 60 ? 'high_risk' : riskScore >= 30 ? 'caution' : 'safe';

  const ageText =
    intel.ageDays !== null ? `deployed ${intel.ageDays} day(s) ago` : 'with an unknown deployment date';
  const verifiedText =
    intel.isVerified === true ? 'Verified' : intel.isVerified === false ? 'Unverified' : 'Verification unknown';

  const plainEnglishSummary =
    recommendation === 'safe'
      ? `${verifiedText} contract ${ageText}. No elevated risk signals found — this is not an audit.`
      : `${verifiedText} contract ${ageText}. ${warnings.length} risk signal(s) found; review them before approving funds.`;

  return {
    tokenAddress: clean,
    tokenSymbol: intel.contractName || 'TOKEN',
    tokenName: intel.contractName || 'EVM Contract',
    isVerified: intel.isVerified,
    contractAgeDays: intel.ageDays,
    riskScore,
    warnings,
    recommendation,
    plainEnglishSummary,
    intel,
  };
}
