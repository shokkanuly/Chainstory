import { describe, it, expect } from 'vitest';
import { simulateUnsignedTransaction, type GuardSimulationInput } from '../chains/solana/guard';

describe('Guard Pre-Sign Simulation (Phase 4)', () => {
  const SUBJECT = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

  it('simulates a benign Jupiter swap and generates human-readable preview', () => {
    const input: GuardSimulationInput = {
      subject: SUBJECT,
      programIds: [
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token
      ],
      instructions: [
        { programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' },
      ],
      expectedSolDeltaLamports: -1_000_000_000n, // -1 SOL
      expectedTokenDeltas: [
        {
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          deltaAmount: 180_000_000n,
          symbol: 'USDC',
        },
      ],
    };

    const res = simulateUnsignedTransaction(input);

    expect(res.isSafeToProceed).toBe(true);
    expect(res.previewStory).toContain('Swap preview: Send 1.0000 SOL to receive tokens');
    expect(res.netSolChange).toBe('-1.0000 SOL');
    expect(res.tokenChanges).toHaveLength(1);
    expect(res.tokenChanges[0].symbol).toBe('USDC');
    expect(res.riskFlags).toHaveLength(0); // All programs are recognized
  });

  it('flags unverified / unknown programs and severe drain outflows', () => {
    const drainInput: GuardSimulationInput = {
      subject: SUBJECT,
      programIds: ['SuspiciousDrainerProgram11111111111111111111'],
      instructions: [
        { programId: 'SuspiciousDrainerProgram11111111111111111111' },
      ],
      expectedSolDeltaLamports: -10_000_000_000n, // -10 SOL drain
    };

    const res = simulateUnsignedTransaction(drainInput);

    expect(res.isSafeToProceed).toBe(false); // Critical flag present
    expect(res.riskFlags.some((f) => f.id.startsWith('unknown_prog'))).toBe(true);
    expect(res.riskFlags.some((f) => f.id === 'high_sol_drain')).toBe(true);
  });
});
