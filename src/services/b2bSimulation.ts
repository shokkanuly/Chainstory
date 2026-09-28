// src/services/b2bSimulation.ts
//
// B2B Pre-Sign Transaction Security & Narrative Simulation API (@retold/core).
// Decodes raw eth_sendTransaction payloads into human-readable warnings and pre-sign narratives
// before a user signs a transaction in a Web3 wallet.

import type { B2BSimulationPayload, B2BSimulationResult, TaxCategory } from '../types';
import { decodeAbiData, decodeApproval, decodeTokenTransfer } from './abiDecoder';
import { getProtocolGroup, isKnownContract } from './protocolRegistry';

const short = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;

export function simulateTransactionPayload(
  payload: B2BSimulationPayload
): B2BSimulationResult {
  const { to, value, data } = payload;
  const decoded = decodeAbiData(data);
  // The spender and recipient are calldata arguments; `to` is the token.
  const approval = decodeApproval(data);
  const transfer = decodeTokenTransfer(data);
  const protocolGroup = getProtocolGroup(to);
  const isKnown = isKnownContract(to);

  let severity: 'safe' | 'caution' | 'danger' = 'safe';
  const riskWarnings: string[] = [];
  let category: TaxCategory = 'unknown';

  // Unknown input never throws (I8): an unparseable value reads as zero.
  let weiValue = 0n;
  try {
    weiValue = BigInt(value || '0');
  } catch {
    riskWarnings.push('Transaction value could not be read');
  }
  const ethValue = Number(weiValue) / 1e18;

  // 1. Evaluate Method & Severity
  if (decoded.signature === '0x095ea7b3') {
    // ERC-20 Approve
    severity = 'caution';
    category = 'transfer';
    riskWarnings.push('Granting spending permission to third-party contract');
    // Read from the amount argument. Searching the whole calldata for 64 f's
    // missed the uint128-max variants and could match inside other arguments.
    if (approval?.isUnlimited) {
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
    // Name the spender, not `to`: `to` is the token contract, and naming it
    // here told users the wrong party would hold the permission.
    plainEnglishDescription = approval
      ? `Allow ${short(approval.spender)} to spend your tokens held at ${short(to)}`
      : `Grant a spending permission on the token at ${short(to)}`;
  } else if (transfer) {
    headline = 'Send Tokens';
    plainEnglishDescription = `Send tokens held at ${short(to)} to ${short(transfer.recipient)}`;
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
