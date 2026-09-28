import { defaultRegistry } from './registry';
import { evmAdapter } from './evm/adapter';
import { solanaAdapter } from './solana/adapter';

// Auto-register default adapters
defaultRegistry.register(evmAdapter);
defaultRegistry.register(solanaAdapter);

export * from './types';
export * from './http';
export * from './registry';
export * from './evm/adapter';
export * from './solana/adapter';
