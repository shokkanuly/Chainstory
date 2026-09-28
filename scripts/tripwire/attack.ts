// scripts/tripwire/attack.ts
//
// The scripted attack, in four steps. Each step writes bridge events to the
// feeds exactly as a chain would (burns on the source, releases on the
// destination), then the vault tries to pay each release out. Nothing here
// sets a score: every tier comes from the watcher scoring what it sees.
//
//   0  Ordinary traffic               → nothing to attest            NONE
//   1  Funds to a drain-profile       → one strong suspicion         THROTTLE
//      contract
//   2  A burst to the same contract   → the contract and the volume  DELAY
//                                       corroborate each other
//   3  A forged release, no burn      → proof of a broken invariant  FREEZE
//      behind it
//
// Amounts are USDC base units (6 decimals).

import { keccak256, toHex, type Hex } from 'viem';
import type { ContractRiskSummary } from '../../src/tripwire/types.js';
import type { BurnEvent, MemoryFeed, ReleaseEvent } from './events.js';

export const USDC = 10n ** 6n;

export const ALICE: Hex = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
export const BOB: Hex = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc';
export const CAROL: Hex = '0x90f79bf6eb2c4f870365e785982e1f101e93b906';
/** The attacker's receiving contract. */
export const DRAIN_CONTRACT: Hex = '0x9999999999999999999999999999999999999999';

/**
 * Synthetic explorer facts for the attacker's contract: the local EVM has no
 * explorer. On a testnet the watcher gets these from Retold's fetchContractIntel
 * through server/explorerTransport.ts instead.
 */
export const DRAIN_CONTRACT_FACTS: ContractRiskSummary = {
  address: DRAIN_CONTRACT,
  isVerified: false,
  ageDays: 1,
  isUpgradeable: true,
  adminFunctions: [],
};

export interface Payout {
  recipient: Hex;
  amount: bigint;
  /** What the source chain burned for it; 0n for a release with no burn behind it. */
  burned: bigint;
}

export interface AttackStep {
  title: string;
  payouts: Payout[];
}

export const ATTACK_STEPS: AttackStep[] = [
  {
    title: 'Ordinary traffic',
    payouts: [
      { recipient: ALICE, amount: 35_000n * USDC, burned: 35_000n * USDC },
      { recipient: BOB, amount: 12_000n * USDC, burned: 12_000n * USDC },
      { recipient: CAROL, amount: 48_000n * USDC, burned: 48_000n * USDC },
    ],
  },
  {
    title: 'Moderate: a payout to a brand-new, unverified, upgradeable contract',
    payouts: [{ recipient: DRAIN_CONTRACT, amount: 60_000n * USDC, burned: 60_000n * USDC }],
  },
  {
    title: 'High: a burst to the same contract, 10× the route’s usual size',
    payouts: [
      { recipient: DRAIN_CONTRACT, amount: 900_000n * USDC, burned: 900_000n * USDC },
      // An honest user in the same minute: DELAY holds only large outflows.
      { recipient: ALICE, amount: 40_000n * USDC, burned: 40_000n * USDC },
    ],
  },
  {
    title: 'Critical: a forged release with no burn behind it',
    payouts: [{ recipient: DRAIN_CONTRACT, amount: 11_580_000n * USDC, burned: 0n }],
  },
];

let sequence = 0;

/** Write one step's events: each burn on the source chain, then the release on the destination. */
export function playStep(
  step: AttackStep,
  now: number,
  feeds: { ingress: MemoryFeed<BurnEvent>; egress: MemoryFeed<ReleaseEvent> }
): ReleaseEvent[] {
  return step.payouts.map((p) => {
    const messageId = keccak256(toHex(`tripwire-demo-message-${++sequence}`));
    if (p.burned > 0n) feeds.ingress.emit({ messageId, amount: p.burned, timestamp: now });
    const release: ReleaseEvent = { messageId, recipient: p.recipient, amount: p.amount, timestamp: now };
    feeds.egress.emit(release);
    return release;
  });
}
