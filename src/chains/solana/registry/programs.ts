export interface ProgramRegistryEntry {
  programId: string;
  protocol: string;
  name: string;
  category: 'system' | 'token' | 'dex' | 'staking' | 'compression' | 'compute';
  source: string;
  verifiedAt: string;
}

export const SOLANA_PROGRAMS: Record<string, ProgramRegistryEntry> = {
  '11111111111111111111111111111111': {
    programId: '11111111111111111111111111111111',
    protocol: 'system',
    name: 'System Program',
    category: 'system',
    source: 'https://docs.solana.com/developing/runtime-facilities/programs#system-program',
    verifiedAt: '2026-03-01',
  },
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': {
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    protocol: 'spl-token',
    name: 'SPL Token Program',
    category: 'token',
    source: 'https://spl.solana.com/token',
    verifiedAt: '2026-03-01',
  },
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb': {
    programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    protocol: 'spl-token-2022',
    name: 'Token-2022 Program',
    category: 'token',
    source: 'https://spl.solana.com/token-2022',
    verifiedAt: '2026-03-01',
  },
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': {
    programId: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    protocol: 'associated-token-account',
    name: 'Associated Token Account Program',
    category: 'token',
    source: 'https://spl.solana.com/associated-token-account',
    verifiedAt: '2026-03-01',
  },
  'ComputeBudget111111111111111111111111111111': {
    programId: 'ComputeBudget111111111111111111111111111111',
    protocol: 'compute-budget',
    name: 'Compute Budget Program',
    category: 'compute',
    source: 'https://docs.solana.com/developing/runtime-facilities/programs#compute-budget-program',
    verifiedAt: '2026-03-01',
  },
  'Stake11111111111111111111111111111111111111': {
    programId: 'Stake11111111111111111111111111111111111111',
    protocol: 'stake',
    name: 'Stake Program',
    category: 'staking',
    source: 'https://docs.solana.com/developing/runtime-facilities/programs#stake-program',
    verifiedAt: '2026-03-01',
  },
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': {
    programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    protocol: 'jupiter',
    name: 'Jupiter v6 Routing',
    category: 'dex',
    source: 'https://station.jup.ag/docs/apis/swap-api',
    verifiedAt: '2026-03-01',
  },
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': {
    programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    protocol: 'raydium',
    name: 'Raydium Liquidity Pool V4',
    category: 'dex',
    source: 'https://raydium.io/docs',
    verifiedAt: '2026-03-01',
  },
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': {
    programId: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
    protocol: 'orca',
    name: 'Orca Whirlpools',
    category: 'dex',
    source: 'https://orca.so',
    verifiedAt: '2026-03-01',
  },
};

export function resolveSolanaProgram(programId: string): ProgramRegistryEntry | undefined {
  return SOLANA_PROGRAMS[programId];
}
