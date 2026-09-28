// src/chains/solana/registry/light.ts
// Program IDs and registry for Light Protocol ZK Compression v1 & v2

export interface LightProgramConfig {
  programId: string;
  name: string;
  type: 'system' | 'token' | 'compression' | 'noop';
  version: 'v1' | 'v2';
  description: string;
}

export const LIGHT_PROGRAMS: Record<string, LightProgramConfig> = {
  'SysProgram1111111111111111111111111111111111': {
    programId: 'SysProgram1111111111111111111111111111111111',
    name: 'Light System Program',
    type: 'system',
    version: 'v1',
    description: 'Manages creation, nullification, and state roots for compressed accounts and SOL',
  },
  'cTokenmWWQr26tuStAepFuknRht84P8U8861j7vK6vM': {
    programId: 'cTokenmWWQr26tuStAepFuknRht84P8U8861j7vK6vM',
    name: 'Compressed Token Program',
    type: 'token',
    version: 'v1',
    description: 'Compressed SPL tokens and Token-2022 compatibility layer',
  },
  'cmtDvXumGCrqC1Age74AVPhYWVXJMd8PJSKezK52rk5': {
    programId: 'cmtDvXumGCrqC1Age74AVPhYWVXJMd8PJSKezK52rk5',
    name: 'Account Compression Program',
    type: 'compression',
    version: 'v1',
    description: 'Maintains state Merkle trees and nullifier queues',
  },
  'noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV': {
    programId: 'noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV',
    name: 'SPL Noop Program',
    type: 'noop',
    version: 'v1',
    description: 'Emits ledger logs for off-chain Photon indexer ingestion',
  },
};

export function isLightProgram(programId: string): boolean {
  return !!LIGHT_PROGRAMS[programId];
}

export function getLightProgram(programId: string): LightProgramConfig | undefined {
  return LIGHT_PROGRAMS[programId];
}
