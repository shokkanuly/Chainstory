<p align="center">
  <img src="https://img.shields.io/badge/Solidity-0.8.37-363636?logo=solidity&logoColor=white" alt="Solidity" />
  <img src="https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/viem-2.56-FFC517" alt="viem" />
  <img src="https://img.shields.io/badge/tests-173_passing-brightgreen" alt="Tests" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

# Tripwire

### A predictive circuit breaker for bridges.

An off-chain risk oracle scores each release a bridge is about to make. When a
score crosses threshold, it signs an EIP-712 attestation that pauses **that one
route** for 24 hours — not the whole bridge — and a human reviews it.

The guardian contract is EVM-only and deploys as identical bytecode to any EVM
chain. The demo routes sit on Ethereum, Arbitrum, Base and Optimism.

---

## The problem

Bridge exploits cost $328.6M across at least eight hacks by mid-May 2026
([The Crypto Times](https://www.cryptotimes.io/2026/05/18/crypto-bridge-hacks-top-328m-in-2026-as-cross-chain-exploits-accelerate/)).
Three of them, checked against their sources:

| Incident | What the bridge failed to check | Loss |
| :--- | :--- | :--- |
| **Verus–Ethereum**, 18 May 2026 | Verified the state root, Merkle proof and hash binding — never checked the payout matched the amount burned | $11.58M |
| **Syscoin**, 7 Jun 2026 | A parser bug accepted a burn with duplicate asset commitments, releasing 5B SYS on NEVM with no equivalent burn | ~$10M, later returned |
| **Kelp DAO rsETH**, 18 Apr 2026 | A 1-of-1 LayerZero DVN was fed false data; a forged packet released rsETH that was never sent | ~$292M |

Two things the sources say that matter more than the headline numbers:

- **Each drain was a single transaction.** Chainalysis: "the main theft was
  executed in a single release." A breaker that reacts once a transaction has
  been included cannot stop that transaction.
- **Human response was fast, and still after the fact.** The Arbitrum Security
  Council froze 30,766 ETH of Kelp's downstream funds two days later — a
  response [Chainalysis](https://www.chainalysis.com/blog/kelpdao-bridge-exploit-april-2026/)
  called unusually fast. It recovered part of what had left; it could not stop
  it leaving.

So the gap is not "humans are slow". It is that anything acting after inclusion
is too late for a one-transaction drain. EIP-7265 rate limits and CCIP's
emergency controls exist, but a static cap stops a drain only if the cap is set
below the drain, and nothing decides *before* execution that a release is wrong.

## How it works

```
      a release the bridge is about to make
                     │
            ┌────────▼─────────┐
            │   risk oracle    │  four rules, explainable,
            │                  │  degrades loudly
            └────────┬─────────┘
                     │ score ≥ 0.75
            ┌────────▼─────────┐
            │   attestation    │  EIP-712, chain-bound,
            │                  │  single-use, 10-minute TTL
            └────────┬─────────┘
                     │
            ┌────────▼─────────┐
            │ TripwireGuardian │  pauses that route for 24h;
            │  (any EVM chain) │  the release reverts
            └──────────────────┘
```

## The four rules

| Rule | Catches | Kind |
| :--- | :--- | :--- |
| **Proof/payout mismatch** | A payout not backed by a burn Tripwire can verify — including one with no burn at all | Deterministic: scores 1.0 |
| **Size vs route baseline** | One release far outside what the route normally does, or taking a large share of liquidity | Probabilistic |
| **Withdrawal velocity** | A burst that drains the pool while each release stays under a cap | Probabilistic |
| **Counterparty screening** | A recipient already attributed to a hack or sanctioned | Deterministic when flagged |

A deterministic signal is proof of a broken invariant, so it scores 1.0 rather
than being averaged against calm signals. A severe probabilistic signal cannot
pause on its own, but is floored to `elevated` so a human always sees it.

The first rule catches all three incidents above, and it depends only on their
reported mechanism. Verus paid out 965× the burn. Syscoin and Kelp paid out
against no verifiable burn at all — which the rule used to skip as "no data"
until the replay work showed it was the worst case, not a missing one.

## Failing loudly

`indeterminate` is a first-class verdict. If a price is missing or a route's
baseline is stale or thin, the oracle says so rather than scoring zero. A
breaker that fails open is worse than none, because it is trusted.

That rule is enforced end to end. The guardian refuses an attestation it cannot
verify; the replay throws if the guardian refuses one, rather than displaying a
pause that never happened; and the test suite fails if the oracle's trip
threshold and the guardian's ever drift apart — which they once did, so that the
oracle's most certain verdict was rejected on-chain.

## Incident replay

`/tripwire` replays all three incidents through the real oracle and the real
guardian bytecode, running in an in-browser EVM. Each release goes to two
guardian deployments at once:

| | Verus | Syscoin | Kelp DAO |
| :--- | ---: | ---: | ---: |
| What actually happened | $11.58M | $10M | $292M |
| Tripwire, **before execution** | **$0** | **$0** | **$0** |
| Tripwire, after inclusion | $11.58M | $10M | $292M |
| Honest withdrawals held for review | 5 | 5 | 7 |

The after-inclusion column is shown on purpose. It is the honest boundary of
the idea: Tripwire only helps against a single-release drain if it sees the
release before it executes — from the public mempool, or through a hook in the
bridge's relayer. A private orderflow route that hides the transaction from
both defeats it. The held withdrawals are the cost of pausing a route.

Every replay is a reconstruction: it reproduces what each attack looked like to
the bridge, with no real transaction hashes. Sourced facts and assumptions are
listed separately for each incident on the page, and the sources were checked
on 25 Sep 2026.

## Repository

| Path | What |
| :--- | :--- |
| `src/tripwire/` | Risk oracle, score mapping, the in-browser guardian VM |
| `src/tripwire/replay/` | Incident fixtures, the replay engine and its controller |
| `src/components/tripwire/` | The `/tripwire` dashboard |
| `contracts/evm/` | TripwireGuardian (Solidity) and its test suite |
| `src/services/` | Chain indexing, feature extraction, contract intel, screening — from ChainStory |
| `docs/chainstory.md` | ChainStory, the wallet-intelligence engine underneath |

Tripwire is built on **ChainStory**, a wallet-intelligence app that turns raw
EVM history into plain English with a draft tax report and a risk check. That
app still works at `/app`.

## Status

| Piece | State |
| :--- | :--- |
| Risk oracle | **Working** — 19 tests |
| TripwireGuardian | **Verified** — 35 tests in a real EVM, 13/13 mutants caught |
| Oracle ↔ guardian boundary | **Pinned** — 9 cross-layer tests |
| Incident replay and dashboard | **Working** — 41 tests, verified in the browser in light, dark and at phone width |
| Attestation relayer for a live chain | Not built — the replay signs and submits in-browser |
| Solana | Dropped for now |

Nothing here is deployed to a real chain.

```bash
npm install
npm test                          # 173 tests: oracle, guardian in an EVM, replay
node contracts/evm/compile.mjs    # rebuild the guardian artifact
npm run dev                       # then open /tripwire
```

## License

MIT
