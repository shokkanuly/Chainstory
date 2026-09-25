<p align="center">
  <img src="https://img.shields.io/badge/Solidity-0.8.37-363636?logo=solidity&logoColor=white" alt="Solidity" />
  <img src="https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Chains-4_EVM_%2B_Solana-F6851B?logo=ethereum&logoColor=white" alt="Chains" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/status-in_progress-orange" alt="Status" />
</p>

# Tripwire

### A predictive, cross-chain circuit breaker for bridges.

One off-chain risk oracle watches transfers across Ethereum, Arbitrum, Base,
Optimism and Solana. When a transfer's risk score crosses threshold, it submits
a signed attestation that pauses **that one route** for a timelock — not the
whole bridge.

It does not replace human incident response. It buys the time that response
needs.

---

## The problem

Bridge exploits cluster into three patterns, and only the third is a gap
nobody has filled:

1. **Proof-verification logic bugs.** The Verus–Ethereum bridge verified the
   notarised state root, the Merkle proof and the hash binding — and never
   checked that the claimed payout matched the burn.
2. **Off-chain and human compromise.** Kelp DAO's loss traced to a single-DVN
   LayerZero configuration; Drift's to a months-long social engineering
   campaign. Neither shows up in an audit.
3. **Detection is fast; response is slow.** After the Kelp DAO exploit it took
   the Arbitrum Security Council *three days* to move to freeze the attacker's
   downstream funds. That is long enough to launder everything.

The fix for the third pattern partly exists. EIP-7265 defines an on-chain
circuit breaker, and CCIP ships emergency rate limits. Two things are missing:
something that decides **when** to trip ahead of a full drain rather than on a
static cap, and **any equivalent on Solana**.

## How it works

```
        transfers (5 chains)
                 │
         ┌───────▼────────┐
         │  risk oracle   │   4 rules, explainable, degrades loudly
         └───────┬────────┘
                 │ score ≥ threshold
         ┌───────▼────────┐
         │  attestation   │   signed, chain-bound, replay-proof
         └───┬────────┬───┘
             │        │
      ┌──────▼──┐  ┌──▼─────────┐
      │ EVM     │  │ Solana     │
      │ guardian│  │ guardian   │
      │ ×4 same │  │ Anchor     │
      │ bytecode│  │ program    │
      └─────────┘  └────────────┘
                 │
          route paused for a timelock
          → human review in minutes, not days
```

## The four rules

Each closes a gap a volume cap cannot see. Each is explainable in one sentence,
which matters when the output pauses somebody's bridge.

| Rule | Catches | Kind |
| :--- | :--- | :--- |
| **Proof/payout mismatch** | The claimed payout is not backed by the proven burn | Deterministic — trips outright |
| **Size vs route baseline** | One transfer far outside what this route does, or taking a large share of liquidity | Probabilistic |
| **Withdrawal velocity** | A burst that drains the pool while each transfer stays under the cap | Probabilistic |
| **Counterparty screening** | Recipient already attributed to a hack or sanctioned | Deterministic when flagged |

Two floors sit on top of the weighted mean. A **deterministic** signal is proof
of a broken invariant and trips on its own — three calm signals must not be
able to average it back under threshold. A **severe** probabilistic signal
cannot trip alone, but is floored into `elevated` so it is never averaged out
of sight. That second floor exists because probing the score curve found a
transfer at 10× its route's p95 scoring 0.445 against a 0.45 threshold, and
reporting *clear*.

## Failing loudly

`indeterminate` is a first-class verdict, not an error.

A circuit breaker that fails open is worse than no circuit breaker, because it
is trusted. If a price is unavailable or a route's baseline is stale or too
thin, the oracle returns `indeterminate` with a reason — never a low score. The
decision layer reads that as *do not vouch for this transfer*, not as *safe*.

This is not hypothetical. The wallet-intelligence engine this project is built
on shipped a bug where a third-party ENS resolver went down, the failure was
treated as "no result" rather than "failed", and the app served synthetic data
while blaming a missing API key that was present. The same instinct in a
circuit breaker returns a clean score for a transfer it never examined.

## Repository

| Path | What |
| :--- | :--- |
| `src/tripwire/` | The risk oracle: rules, scoring, verdicts |
| `contracts/` | EVM guardian (Solidity), identical bytecode across 4 chains |
| `solana/` | Anchor guardian program — not yet written |
| `src/services/` | Chain indexing, feature extraction, contract intel, screening — from ChainStory, reused as oracle inputs |
| `src/components/`, `src/pages/` | The wallet-intelligence app and the incident dashboard |
| `docs/chainstory.md` | Full ChainStory documentation — the analysis engine underneath |

Tripwire is built on **ChainStory**, a wallet-intelligence app that turns raw
EVM history into plain English with a draft tax report and a risk check. Its
multi-chain indexing, 14-field feature extraction, contract intelligence and
counterparty screening are the oracle's inputs rather than a separate product.

## Status

Honest, and short.

| Piece | State |
| :--- | :--- |
| Risk oracle — 4 rules, verdicts, degraded handling | **Working**, 16 tests |
| EVM guardian | **Compiles clean**, behaviour untested — needs Foundry |
| Solana Anchor guardian | Not started — needs the Rust/Anchor toolchain |
| Incident replay against real Verus / Syscoin / Kelp sequences | Not started — needs the real on-chain sequences pulled |
| Attestation signing service | Not started |
| ChainStory wallet intelligence | Working — see [docs/chainstory.md](docs/chainstory.md) |

Nothing here is deployed, and the guardian should not be until its test suite
exists. See [contracts/README.md](contracts/README.md).

```bash
npm install
npm test                      # oracle tests
node contracts/compile.mjs    # guardian builds clean
npm run dev
```

## License

MIT
