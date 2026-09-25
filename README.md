<p align="center">
  <img src="public/brand/tripwire-mark.svg" width="72" alt="" />
</p>

<h1 align="center">Tripwire</h1>

<p align="center">
  <strong>A circuit breaker for bridges that acts <em>before</em> the money moves.</strong>
</p>

<p align="center">
  <a href="https://retold-nu.vercel.app/tripwire"><strong>▶ Live demo</strong></a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#run-it-locally">Run it locally</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Solidity-0.8.37-363636?logo=solidity&logoColor=white" alt="Solidity" />
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/viem-2.56-FFC517" alt="viem" />
  <img src="https://img.shields.io/badge/tests-104_passing-brightgreen" alt="104 tests passing" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT" />
</p>

---

On 18 April 2026, $292M left Kelp DAO's bridge. Not over hours — in **a single
release**. Verus lost $11.58M the same way in May, Syscoin ~$10M in June.

Every defence that exists today — rate limits, emergency pauses, security
councils — acts **after** a transaction lands. Against a one-transaction drain,
that is too late by definition.

Tripwire checks one invariant *before* a bridge pays out — **is this payout
backed by a burn we can independently verify?** — and if not, pauses just that
route.

## The result

We replayed all three exploits through Tripwire's oracle and its guardian
contract. Each release is sent to two deployments at once: one that acts before
execution, one that acts a block later.

| | Verus | Syscoin | Kelp DAO |
| :--- | ---: | ---: | ---: |
| What actually happened | $11.58M | $10M | $292M |
| **Tripwire — before execution** | **$0** | **$0** | **$0** |
| Tripwire — one block later | $11.58M | $10M | $292M |

The last row is shown on purpose. It is the whole argument: for these attacks,
a breaker acts before execution or it does not act at all.

**[Watch it happen →](https://retold-nu.vercel.app/tripwire?incident=kelp)**

## How it works

```
   a release the bridge is about to make
                   │
          ┌────────▼─────────┐
          │   risk oracle    │  is the payout backed by a verifiable burn?
          │                  │  plus size, velocity, counterparty
          └────────┬─────────┘
                   │  score ≥ 0.75
          ┌────────▼─────────┐
          │   attestation    │  EIP-712 signed · chain-bound
          │                  │  single-use · valid 10 minutes
          └────────┬─────────┘
                   │
          ┌────────▼─────────┐
          │ TripwireGuardian │  pauses that one route for 24h
          │  any EVM chain   │  → the release reverts → a human reviews
          └──────────────────┘
```

### What the oracle checks

| Rule | Catches | Kind |
| :--- | :--- | :--- |
| **Payout vs burn** | Money released that was never burned on the source chain | Proof — scores 1.0 |
| **Size vs baseline** | A release far outside what the route normally does | Estimate |
| **Withdrawal velocity** | A burst that drains the pool under a per-transfer cap | Estimate |
| **Counterparty** | A recipient already tied to a hack or sanctions | Proof, when flagged |

The first rule catches all three incidents, and it depends only on their
reported mechanism: Verus paid out **965×** the burn; Syscoin and Kelp paid out
against **no verifiable burn at all**.

### Built to fail safe

| The oracle can... | ...so a stolen oracle key means |
| :--- | :--- |
| pause one route | a delay on that route |
| **not** move funds, raise caps, or unpause | never a theft |

- **Every pause expires** after 24 hours. The oracle cannot brick a bridge.
- **Attestations cannot be replayed** — across chains, contracts, or time.
- **Unknown routes fail closed.** A breaker should not guess.
- **The oracle never fakes confidence.** A missing price or a stale baseline
  returns `indeterminate`, not a low score. A breaker that fails open is worse
  than none, because it is trusted.

## Honest limits

- **Tripwire must see the release before it executes** — through the bridge's
  relayer, or the public mempool. An attacker using private orderflow bypasses
  the mempool path; the relayer hook is the answer, and it is next on the roadmap.
- **Pausing has a cost.** In the replays, 5–7 legitimate withdrawals wait for
  review. The dashboard shows it.
- **The replays are reconstructions** of what each attack looked like to the
  bridge — no real transaction hashes. Every sourced fact and every assumption
  is listed separately on the page.
- **Not deployed to a live chain yet.** The demo runs the compiled guardian in
  an EVM inside your browser.

## Proof it works

| Check | Result |
| :--- | :--- |
| Guardian executed in a real EVM | 35 / 35 tests |
| Each safety property broken on purpose | 13 / 13 caught |
| Oracle and contract agree on the threshold | 9 cross-layer tests |
| Incident replays, end to end | 41 tests |
| Gas: check an outflow · accept an attestation | 34k · 61k |
| Total | **104 tests passing** |

The dashboard runs the exact contract bytecode the tests run, and a test fails
if they ever differ.

## Run it locally

```bash
git clone https://github.com/shokkanuly/Chainstory.git
cd Chainstory
npm install
npm run dev          # open http://localhost:5173
npm test             # 104 tests
```

No API keys needed for the Tripwire demo.

## Repository

| Path | What |
| :--- | :--- |
| [`src/tripwire/`](src/tripwire/) | Risk oracle and the in-browser guardian |
| [`src/tripwire/replay/`](src/tripwire/replay/) | The three incidents and the replay engine |
| [`src/components/tripwire/`](src/components/tripwire/) | The `/tripwire` dashboard |
| [`contracts/evm/`](contracts/evm/) | TripwireGuardian in Solidity, and its tests |


## Sources

Checked 25 September 2026.

- [Chainalysis — KelpDAO bridge exploit](https://www.chainalysis.com/blog/kelpdao-bridge-exploit-april-2026/)
- [The Crypto Times — Bridge hacks top $328M in 2026](https://www.cryptotimes.io/2026/05/18/crypto-bridge-hacks-top-328m-in-2026-as-cross-chain-exploits-accelerate/)
- [Syscoin — Technical postmortem](https://syscoin.org/news/technical-postmortem-syscoin-bridge-incident-recovery-and-remediation)

## License

MIT
