// src/tripwire/replay/incidents.ts
//
// Three real 2026 bridge exploits, reconstructed for replay.
//
// What is sourced and what is not, kept apart on purpose:
//
//   Sourced (see `sources`, each checked against the linked page): the date,
//   the reported loss, the mechanism, the number of draining transactions
//   where stated, and what happened afterwards.
//
//   Not sourced, and labelled in `assumptions`: the background traffic, the
//   route statistics it is scored against, and any timing the reports do not
//   give. None of these decide the outcome — every exploit here is caught by
//   one invariant, "a payout must be backed by a burn Tripwire can verify",
//   which depends only on the sourced mechanism.
//
// No transaction hashes appear: the replay reproduces what each attack looked
// like to a bridge, not its literal on-chain records.

import type { RouteBaseline } from '../types.js';

export type EventKind = 'legit' | 'exploit' | 'follow_up';

export interface IncidentEvent {
  /** Seconds after the replay starts. */
  t: number;
  kind: EventKind;
  /** Value leaving the bridge if this release executes. */
  amountUsd: number;
  claimedPayoutUsd: number;
  /** What Tripwire's own source-chain index can verify was burned. Zero: nothing. */
  provenBurnUsd: number;
  to: `0x${string}`;
  label: string;
  /** Set on the events a report describes. */
  sourced?: string;
  /** The real incident stopped this one without Tripwire. */
  stoppedInReality?: boolean;
}

export interface Source {
  label: string;
  url: string;
}

export interface Incident {
  id: 'verus' | 'syscoin' | 'kelp';
  name: string;
  /** ISO date of the exploit, as reported. */
  date: string;
  chainLabel: string;
  routeLabel: string;
  /** One sentence: what the bridge failed to check. */
  mechanism: string;
  reportedLossUsd: number;
  reportedLossDetail?: string;
  /** What actually happened next. */
  aftermath: string;
  sources: Source[];
  assumptions: string[];
  events: IncidentEvent[];
}

/**
 * Illustrative route statistics, shared by every replay. Not any real
 * bridge's numbers: they exist so the background traffic has something to be
 * scored against, and so the size and velocity rules have a baseline.
 */
export const ILLUSTRATIVE_BASELINE: Omit<RouteBaseline, 'route' | 'computedAt'> = {
  windowHours: 720,
  sampleSize: 43_200, // ~1 transfer a minute for 30 days
  medianTransferUsd: 15_000,
  p95TransferUsd: 110_000,
  rollingTvlUsd: 60_000_000,
};

/** One block on the destination chain: when a post-inclusion attestation lands. */
export const BLOCK_SECONDS = 12;

export const ATTACKER: `0x${string}` = '0xa77ac4e7000000000000000000000000000000a1';

// Deterministic, so a replay is identical every time it is run or tested.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ordinary withdrawals: backed by their burn, less a bridge fee, sized like the baseline. */
function background(seed: number, from: number, to: number): IncidentEvent[] {
  const rand = rng(seed);
  const out: IncidentEvent[] = [];
  for (let t = from; t < to; t += 45 + Math.floor(rand() * 30)) {
    // Log-uniform between $2k and $95k: mostly small, occasionally large, never above p95.
    const amount = Math.round(2_000 * Math.pow(95_000 / 2_000, rand()) / 10) * 10;
    const recipient = Math.floor(rand() * 0xffffff).toString(16).padStart(6, '0');
    out.push({
      t,
      kind: 'legit',
      amountUsd: amount,
      claimedPayoutUsd: amount,
      provenBurnUsd: Math.round(amount * 1.001), // burn covers payout plus a 0.1% fee
      to: `0x${recipient.repeat(6)}${recipient.slice(0, 4)}` as `0x${string}`,
      label: `Withdrawal · $${amount.toLocaleString('en-US')}`,
    });
  }
  return out;
}

/** Merge background and attack events into one time-ordered sequence. */
const timeline = (...parts: (IncidentEvent | IncidentEvent[])[]): IncidentEvent[] =>
  parts.flat().sort((a, b) => a.t - b.t);

const SHARED_ASSUMPTIONS = [
  'Background withdrawals and route statistics are illustrative, not the real bridge’s traffic.',
  'Tripwire indexes the source chain and independently verifies each release against its burn.',
  `A post-inclusion attestation lands one block (${BLOCK_SECONDS}s) after the release it reacts to.`,
  'Pre-execution means Tripwire scores the release before it executes — from the public mempool, or through a hook in the bridge’s relayer. A private orderflow route that hides the transaction from both defeats it.',
  'The guardian’s rate cap is disabled in this replay, so the outcome reflects the oracle alone.',
];

export const INCIDENTS: Incident[] = [
  {
    id: 'verus',
    name: 'Verus–Ethereum bridge',
    date: '2026-05-18',
    chainLabel: 'Ethereum',
    routeLabel: 'Verus → Ethereum',
    mechanism:
      'The bridge verified the notarised state root, the Merkle proof and the hash binding, but never checked that the stated transfer amount matched the payout.',
    reportedLossUsd: 11_580_000,
    aftermath: 'Not stated in the linked report.',
    sources: [
      {
        label: 'The Crypto Times — Crypto bridge hacks top $328M in 2026',
        url: 'https://www.cryptotimes.io/2026/05/18/crypto-bridge-hacks-top-328m-in-2026-as-cross-chain-exploits-accelerate/',
      },
    ],
    assumptions: [
      'The report does not give the transaction count. Modelled as a single payout — the least favourable case for any breaker.',
      'The burn behind the payout is modelled as $12,000; the report says only that the amounts were never compared.',
      ...SHARED_ASSUMPTIONS,
    ],
    events: timeline(
      ...background(18, 0, 720),
      {
        t: 735,
        kind: 'exploit',
        amountUsd: 11_580_000,
        claimedPayoutUsd: 11_580_000,
        provenBurnUsd: 12_000,
        to: ATTACKER,
        label: 'Payout of $11.58M against a $12k burn',
        sourced: 'Payout amount never checked against the burn',
      },
      ...background(1805, 760, 1020),
    ),
  },
  {
    id: 'syscoin',
    name: 'Syscoin bridge',
    date: '2026-06-07',
    chainLabel: 'Syscoin NEVM (EVM)',
    routeLabel: 'Syscoin UTXO → NEVM',
    mechanism:
      'A parsing error in the relay’s proof validation accepted a burn transaction with duplicate asset commitments, and released 5 billion SYS on NEVM with no equivalent burn.',
    reportedLossUsd: 10_000_000,
    reportedLossDetail: '~5 billion SYS',
    aftermath: 'The bridge was paused. The attacker later returned the 5 billion SYS, which Syscoin burned.',
    sources: [
      {
        label: 'Syscoin — Technical postmortem',
        url: 'https://syscoin.org/news/technical-postmortem-syscoin-bridge-incident-recovery-and-remediation',
      },
      {
        label: 'PricePredictions — valuation of the minted SYS',
        url: 'https://pricepredictions.com/news/syscoin-bridge-exploit-5-billion-sys-tokens-minted-proof-validation-flaw-br7jyfk9',
      },
    ],
    assumptions: [
      'The attacker’s preceding 1,000 TEST probe is omitted: it used a test asset with no USD value, which a USD-denominated rule would not flag.',
      ...SHARED_ASSUMPTIONS,
    ],
    events: timeline(
      ...background(607, 0, 600),
      {
        t: 612,
        kind: 'exploit',
        amountUsd: 10_000_000,
        claimedPayoutUsd: 10_000_000,
        provenBurnUsd: 0,
        to: ATTACKER,
        label: 'Release of 5B SYS (~$10M) with no burn behind it',
        sourced: 'Malformed proof accepted; no equivalent burn',
      },
      ...background(2026, 640, 900),
    ),
  },
  {
    id: 'kelp',
    name: 'Kelp DAO rsETH bridge',
    date: '2026-04-18',
    chainLabel: 'Ethereum',
    routeLabel: 'rsETH · LayerZero',
    mechanism:
      'The bridge relied on a single LayerZero DVN. Attackers fed it false data, and a forged packet released rsETH that was never sent.',
    reportedLossUsd: 292_000_000,
    reportedLossDetail: '116,500 rsETH',
    aftermath:
      'A second forged packet tried to drain another ~$95M and was stopped. On April 20, two days later, the Arbitrum Security Council froze 30,766 ETH of the attacker’s downstream funds — a response Chainalysis called unusually fast.',
    sources: [
      {
        label: 'Chainalysis — KelpDAO bridge exploit',
        url: 'https://www.chainalysis.com/blog/kelpdao-bridge-exploit-april-2026/',
      },
    ],
    assumptions: [
      'The report gives no time between the main theft and the follow-up. Modelled as four minutes.',
      ...SHARED_ASSUMPTIONS,
    ],
    events: timeline(
      ...background(418, 0, 660),
      {
        t: 671,
        kind: 'exploit',
        amountUsd: 292_000_000,
        claimedPayoutUsd: 292_000_000,
        provenBurnUsd: 0,
        to: ATTACKER,
        label: 'Forged packet releases 116,500 rsETH (~$292M)',
        sourced: 'Main theft executed in a single release',
      },
      {
        t: 911,
        kind: 'follow_up',
        amountUsd: 95_000_000,
        claimedPayoutUsd: 95_000_000,
        provenBurnUsd: 0,
        to: ATTACKER,
        label: 'Second forged packet: 40,000 rsETH (~$95M)',
        sourced: 'Follow-up attempt with a second forged packet',
        stoppedInReality: true,
      },
      ...background(2004, 700, 1080).filter((e) => e.t !== 911),
    ),
  },
];

