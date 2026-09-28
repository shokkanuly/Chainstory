// src/services/preSignScenarios.ts
//
// The two "Check before you sign" demo scenarios, shared by the /check page
// and its tests so the demo cannot drift from what is tested.
//
// The calldata is real EIP-20 encoding. The contract facts are SYNTHETIC: they
// have the shape the block explorer returns (see contractIntel.ts), on
// placeholder addresses, so the demo neither depends on a live explorer nor
// claims anything about a real deployed contract. The page labels them as such.

import type { ChainId } from '../types';
import { APPROVE_SELECTOR, MAX_UINT256, TRANSFER_SELECTOR } from './abiDecoder';
import type { ContractIntel } from './contractIntel';
import type { PreSignInput } from './preSignCheck';

export const DEMO_TOKEN = '0x1111111111111111111111111111111111111111';
export const DEMO_RECIPIENT = '0x2222222222222222222222222222222222222222';
export const DEMO_FRESH_SPENDER = '0x3333333333333333333333333333333333333333';

/** The day the synthetic facts describe, so ages do not change as the calendar does. */
const AS_OF = Date.UTC(2026, 8, 28);

/** One 32-byte ABI word. */
const word = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');

function intel(address: string, createdAt: Date, facts: Partial<ContractIntel>): ContractIntel {
  return {
    address,
    status: 'ok',
    isContract: true,
    isVerified: null,
    contractName: null,
    isProxy: false,
    implementationAddress: null,
    createdAt,
    ageDays: Math.floor((AS_OF - createdAt.getTime()) / 86_400_000),
    adminCapabilities: null,
    ...facts,
  };
}

const FACTS: Record<string, ContractIntel> = {
  // A plain, long-lived, verified ERC-20 with no admin functions in its ABI.
  [DEMO_TOKEN]: intel(DEMO_TOKEN, new Date(Date.UTC(2023, 5, 1)), {
    isVerified: true,
    contractName: 'DemoToken',
    adminCapabilities: { canUpgrade: false, canPause: false, canMint: false, hasOwner: false, evidence: [] },
  }),
  // Deployed the day before, source never published.
  [DEMO_FRESH_SPENDER]: intel(DEMO_FRESH_SPENDER, new Date(Date.UTC(2026, 8, 27)), {
    isVerified: false,
  }),
};

export interface PreSignScenario {
  id: 'benign-transfer' | 'unlimited-approval';
  label: string;
  expectedBadge: 'green' | 'red';
  input: PreSignInput;
}

export const PRE_SIGN_SCENARIOS: PreSignScenario[] = [
  {
    id: 'benign-transfer',
    label: 'An ordinary token transfer to another wallet',
    expectedBadge: 'green',
    input: {
      to: DEMO_TOKEN,
      // transfer(DEMO_RECIPIENT, 250_000_000): 250 of a 6-decimal token.
      data: `${TRANSFER_SELECTOR}${word(DEMO_RECIPIENT)}${word((250_000_000n).toString(16))}`,
      value: 0n,
    },
  },
  {
    id: 'unlimited-approval',
    label: 'Unlimited approval to a day-old, unverified contract',
    expectedBadge: 'red',
    input: {
      to: DEMO_TOKEN,
      // approve(DEMO_FRESH_SPENDER, 2^256 - 1)
      data: `${APPROVE_SELECTOR}${word(DEMO_FRESH_SPENDER)}${word(MAX_UINT256.toString(16))}`,
      value: 0n,
    },
  },
];

/** The scenarios' explorer: synthetic facts for their addresses, "unavailable" for anything else. */
export async function scenarioIntel(address: string, _chainId: ChainId): Promise<ContractIntel> {
  const known = FACTS[address.toLowerCase()];
  if (known) return known;
  return {
    ...intel(address, new Date(AS_OF), {}),
    status: 'unavailable',
    unavailableReason: 'This address is not part of the demo scenario',
    isContract: null,
    isProxy: null,
    createdAt: null,
    ageDays: null,
  };
}
