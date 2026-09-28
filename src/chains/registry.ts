import type { AddressMatch, ChainAdapter } from './types';
import type { ChainId } from '../domain';

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const ENS_NAME_REGEX = /^[a-zA-Z0-9.-]+\.eth$/;
const SOLANA_BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SNS_NAME_REGEX = /^[a-zA-Z0-9.-]+\.sol$/;

export function matchAddress(input: string): AddressMatch | null {
  const trimmed = input.trim();
  if (EVM_ADDRESS_REGEX.test(trimmed)) {
    return { input: trimmed, family: 'evm', format: 'hex' };
  }
  if (ENS_NAME_REGEX.test(trimmed)) {
    return { input: trimmed, family: 'evm', format: 'ens' };
  }
  if (SOLANA_BASE58_REGEX.test(trimmed)) {
    return { input: trimmed, family: 'svm', format: 'base58' };
  }
  if (SNS_NAME_REGEX.test(trimmed)) {
    return { input: trimmed, family: 'svm', format: 'sns' };
  }
  return null;
}

export class AdapterRegistry {
  private adapters: Map<string, ChainAdapter> = new Map();

  register(adapter: ChainAdapter): void {
    for (const chain of adapter.chains) {
      this.adapters.set(chain, adapter);
    }
  }

  getAdapterForChain(chain: ChainId): ChainAdapter | undefined {
    return this.adapters.get(chain);
  }

  resolveAdapterForInput(input: string): ChainAdapter | undefined {
    const match = matchAddress(input);
    if (!match) return undefined;

    for (const adapter of this.adapters.values()) {
      if (adapter.family === match.family) {
        return adapter;
      }
    }
    return undefined;
  }
}

export const defaultRegistry = new AdapterRegistry();
