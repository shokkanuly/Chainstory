// src/services/b2bSimulation.ts
//
// B2B Pre-Sign Transaction Security & Narrative Simulation API (@chainstory/core).
// Decodes raw eth_sendTransaction payloads into human-readable warnings and pre-sign narratives
// before a user signs a transaction in a Web3 wallet.

import type { B2BSimulationPayload, B2BSimulationResult, TaxCategory } from '../types';
import { decodeAbiData } from './abiDecoder';
import { getProtocolGroup, isKnownContract } from './protocolRegistry';

export function simulateTransactionPayload(
  payload: B2BSimulationPayload
): B2BSimulationResult {
  const { to, value, data } = payload;
  const decoded = decodeAbiData(data);
  const protocolGroup = getProtocolGroup(to);
  const isKnown = isKnownContract(to);

  let severity: 'safe' | 'caution' | 'danger' = 'safe';
  const riskWarnings: string[] = [];
  let category: TaxCategory = 'unknown';

  const weiValue = BigInt(value || '0');
  const ethValue = Number(weiValue) / 1e18;

  // 1. Evaluate Method & Severity
  if (decoded.signature === '0x095ea7b3') {
    // ERC-20 Approve
    severity = 'caution';
    category = 'transfer';
    riskWarnings.push('Granting spending permission to third-party contract');
    if (data.includes('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')) {
      severity = 'danger';
      riskWarnings.push('CRITICAL: Unlimited token allowance requested');
    }
  } else if (decoded.categoryHint === 'trade' || protocolGroup === 'dex') {
    category = 'trade';
    severity = isKnown ? 'safe' : 'caution';
    if (!isKnown) {
      riskWarnings.push('Interacting with an unverified DEX router contract');
    }
  } else if (decoded.categoryHint === 'nft' || protocolGroup === 'nft_marketplace') {
    category = 'nft';
    severity = 'safe';
  } else if (decoded.categoryHint === 'income' || protocolGroup === 'staking_defi') {
    category = 'income';
    severity = 'safe';
  } else if (!isKnown && data !== '0x' && data.length > 10) {
    severity = 'caution';
    riskWarnings.push('Unrecognized smart contract target address');
  }

  if (ethValue > 5) {
    riskWarnings.push(`High ETH transfer value: ${ethValue.toFixed(2)} ETH`);
    if (severity === 'safe') severity = 'caution';
  }

  // 2. Generate Human-Readable Pre-Sign Narrative
  let headline = `Execute ${decoded.methodName}`;
  let plainEnglishDescription = `You are interacting with contract ${to.slice(0, 6)}...${to.slice(-4)}`;

  if (decoded.signature === '0x095ea7b3') {
    headline = 'Authorize Token Spending';
    plainEnglishDescription = `Allow contract ${to.slice(0, 6)}...${to.slice(-4)} to spend your tokens`;
  } else if (category === 'trade') {
    headline = 'DeFi Token Swap';
    plainEnglishDescription = `Swap ${ethValue > 0 ? ethValue.toFixed(4) + ' ETH' : 'tokens'} via ${protocolGroup.toUpperCase()}`;
  } else if (category === 'nft') {
    headline = 'NFT Marketplace Interaction';
    plainEnglishDescription = `Mint or purchase NFT collectible via ${protocolGroup.toUpperCase()}`;
  } else if (decoded.signature === '0x') {
    headline = 'Direct Ether Transfer';
    plainEnglishDescription = `Transfer ${ethValue.toFixed(4)} ETH to ${to.slice(0, 6)}...${to.slice(-4)}`;
  }

  return {
    severity,
    headline,
    plainEnglishDescription,
    category,
    decodedMethod: decoded.methodName,
    estimatedGasUsd: 2.5,
    riskWarnings,
    simulatedOutput: {
      targetProtocol: protocolGroup !== 'unknown' ? protocolGroup.toUpperCase() : 'Custom Contract',
      expectedAssetIn: ethValue > 0 ? `${ethValue.toFixed(4)} ETH` : undefined,
    },
  };
}
