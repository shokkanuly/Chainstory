// src/chains/solana/guard.ts
// Phase 4: Guard — Pre-Sign Transaction Simulation & Risk Flagging
// Advisory only; read-only; explains state mutations before transaction signing.

import type { Address } from '../../domain';
import { resolveSolanaProgram } from './registry/programs';

export interface GuardSimulationInput {
  subject: Address;
  programIds: string[];
  instructions: Array<{
    programId: string;
    description?: string;
  }>;
  expectedSolDeltaLamports: bigint;
  expectedTokenDeltas?: Array<{
    mint: string;
    deltaAmount: bigint;
    symbol?: string;
  }>;
}

export interface GuardRiskFlag {
  id: string;
  level: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
}

export interface GuardSimulationResult {
  previewStory: string;
  netSolChange: string;
  tokenChanges: Array<{ mint: string; change: string; symbol: string }>;
  riskFlags: GuardRiskFlag[];
  isSafeToProceed: boolean;
  disclaimer: string;
}

export function simulateUnsignedTransaction(
  input: GuardSimulationInput
): GuardSimulationResult {
  const riskFlags: GuardRiskFlag[] = [];

  // 1. Inspect Programs Called
  for (const pid of input.programIds) {
    const known = resolveSolanaProgram(pid);
    if (!known) {
      riskFlags.push({
        id: `unknown_prog_${pid}`,
        level: 'warning',
        title: 'Unknown / Unverified Program',
        detail: `Transaction calls program ${pid} which does not match any recognized DeFi or system protocol.`,
      });
    }
  }

  // 2. Inspect Value Drain / Large Outflows
  if (input.expectedSolDeltaLamports < -5_000_000_000n) {
    riskFlags.push({
      id: 'high_sol_drain',
      level: 'critical',
      title: 'Substantial SOL Outflow',
      detail: `This transaction sends more than 5 SOL out of your wallet.`,
    });
  }

  // 3. Format Human-Readable Net Balance Change
  const solNum = Number(input.expectedSolDeltaLamports) / 1e9;
  const netSolChange = solNum >= 0 ? `+${solNum.toFixed(4)} SOL` : `${solNum.toFixed(4)} SOL`;

  const tokenChanges = (input.expectedTokenDeltas || []).map((t) => ({
    mint: t.mint,
    change: t.deltaAmount >= 0n ? `+${t.deltaAmount.toString()}` : `${t.deltaAmount.toString()}`,
    symbol: t.symbol || 'SPL Token',
  }));

  // Generate preview story
  let previewStory = '';
  if (input.expectedSolDeltaLamports < 0n && (input.expectedTokenDeltas || []).some((t) => t.deltaAmount > 0n)) {
    previewStory = `Swap preview: Send ${Math.abs(solNum).toFixed(4)} SOL to receive tokens`;
  } else if (input.expectedSolDeltaLamports > 0n) {
    previewStory = `Incoming transfer: Receive ${solNum.toFixed(4)} SOL`;
  } else if (input.expectedSolDeltaLamports < 0n) {
    previewStory = `Outgoing transfer: Send ${Math.abs(solNum).toFixed(4)} SOL`;
  } else {
    previewStory = `Contract execution without SOL balance changes`;
  }

  const isSafeToProceed = !riskFlags.some((f) => f.level === 'critical');

  return {
    previewStory,
    netSolChange,
    tokenChanges,
    riskFlags,
    isSafeToProceed,
    disclaimer:
      'Advisory simulation only. Pre-sign simulation does not guarantee on-chain execution, as state or liquidity can shift before inclusion.',
  };
}
