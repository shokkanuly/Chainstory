<p align="center">
  <img src="public/brand/chainstory-mark.svg" width="72" alt="" />
</p>

<h1 align="center">Retold · Tripwire</h1>

<p align="center">
  <strong>Read any wallet. Protect every bridge.</strong>
</p>

<p align="center">
  <a href="https://chainstory-iota.vercel.app/tripwire?incident=kelp"><strong>▶ Tripwire replay</strong></a> ·
  <a href="https://chainstory-iota.vercel.app/check"><strong>▶ Check before you sign</strong></a> ·
  <a href="https://chainstory-iota.vercel.app/app"><strong>▶ Retold app</strong></a> ·
  <a href="#live-on-sepolia">Live on Sepolia</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#run-it-locally">Run it locally</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Solidity-0.8.37-363636?logo=solidity&logoColor=white" alt="Solidity" />
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/viem-2.56-FFC517" alt="viem" />
  <img src="https://img.shields.io/badge/tests-414_passing-brightgreen" alt="414 tests passing" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT" />
</p>

---

## Two products, one idea

On-chain data is machine-readable and human-incomprehensible. We built two
tools on that insight:

| | For | What it does |
| :--- | :--- | :--- |
| **[Retold](https://chainstory-iota.vercel.app/app)** | Anyone with a wallet | Paste an address or ENS name: get its history in plain English, a draft Form 8949 tax report, token approvals and a counterparty risk check. **[Check before you sign](https://chainstory-iota.vercel.app/check)**: paste a pending transaction and get a green, yellow or red badge with its reasons. Read-only — no wallet connection, nothing to sign. |
| **[Tripwire](https://chainstory-iota.vercel.app/tripwire)** | Bridge teams | Scores each bridge payout *before* it executes, and tightens just that route in proportion: throttle, delay, or freeze. |

Retold explains what a transaction did, before or after it is signed. Tripwire
applies the same verification before a bridge payout can do damage, and reuses
Retold's contract checks to do it. The rest of this README is about Tripwire;
Retold's full documentation is in [docs/chainstory.md](docs/chainstory.md).

## Tripwire

**Release hardening (local, 2026-09-30):** the latest `ProtectedVault` requires a
fresh signed review for each payout. Pending, unavailable and held requests cannot
execute; invalid requests remain rejected after route protection expires. The local
demo now runs the actual gated vault as well as the guardian. See the
[hardening plan](docs/plans/tripwire-hardening.md) for the trust boundary and remaining
work: an independent real-bridge/source consensus adapter. The operator now
has durable state, a signed transaction journal, HOLD/delay recovery, finalized RPC
observations and reorg handling; see its
[runbook](docs/plans/tripwire-operator.md).

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

**[Watch it happen →](https://chainstory-iota.vercel.app/tripwire?incident=kelp)**

## Live on Sepolia

The addresses and results below record the **previous deployment**. Its vault has
no per-release review gate. No redeployment has been performed for the hardening
change; the current Sepolia demo scripts detect the old vault and stop before
sending transactions. A fresh deployment is required to run the current loop.

The same loop runs on a public testnet: a scripted attack, a watcher that scores
each payout before it executes, a signed attestation, and the guardian's tier
changing on-chain. Every contract but the attacker's is verified on Etherscan.

| Contract | Role | Address |
| :--- | :--- | :--- |
| TripwireGuardian | The circuit breaker | [`0x6d01…b61f`](https://sepolia.etherscan.io/address/0x6d01c906fa1615791641e17aca615f53885db61f#code) |
| ProtectedVault | The bridge's payout end; pays only through the guardian | [`0x6325…b15c`](https://sepolia.etherscan.io/address/0x6325c9ba6dbc80737ed550ec38d13ddfd397b15c#code) |
| MockSourceBridge | The bridge's source end; records burns | [`0x99a8…cbfa`](https://sepolia.etherscan.io/address/0x99a8c34dd3de64a6267916afd1f138a759c7cbfa#code) |
| DemoUSDC | The token the vault pays out | [`0xaa50…41a8`](https://sepolia.etherscan.io/address/0xaa50b34054195114f38a78e3dbf2a6a4c3ce41a8#code) |
| Attacker's contract | Fresh, unverified, upgradeable (ERC-1967 proxy) — on purpose | [`0x4979…6467`](https://sepolia.etherscan.io/address/0x4979cca7a710d11b9a289b601718e1d954716467) |

What the run did, step by step. Open the guardian's and the vault's transaction
lists to see each attestation and each blocked payout.

| Step | What happens | Score | Guardian tier |
| :--- | :--- | ---: | :--- |
| 0 | Three ordinary payouts, each backed by a burn: all paid | 0.00 | NONE |
| 1 | A payout to the attacker's contract: fresh, unverified, upgradeable | 0.65 | **THROTTLE** — cap halved, still paid |
| 2 | A 900,000 payout to the same contract, 10× the route's usual size | 0.85 | **DELAY** — held (`OutflowDelayed`); an honest 40,000 payout in the same minute is paid |
| 3 | A forged 11,580,000 payout with no burn behind it | 1.00 | **FREEZE** — blocked (`RoutePaused`) |

Reproduce it: `npm run tripwire:demo:local` runs the same four steps against
the real bytecode in a local EVM, no keys needed.
`npm run tripwire:deploy`, `tripwire:verify` and `tripwire:demo:sepolia` do it
on Sepolia ([scripts/tripwire/](scripts/tripwire/)).

## How it works

```
   a release the bridge is about to make
                   │
          ┌────────▼─────────┐
          │   risk oracle    │  is the payout backed by a verifiable burn?
          │                  │  plus size, velocity, counterparty,
          │                  │  and the receiving contract (Retold's checks)
          └────────┬─────────┘
                   │  score ≥ 0.65
          ┌────────▼─────────┐
          │   attestation    │  EIP-712 signed · chain-bound
          │                  │  single-use · valid 10 minutes
          └────────┬─────────┘
                   │
          ┌────────▼─────────┐
          │ TripwireGuardian │  tightens that one route for 24h:
          │  any EVM chain   │  ≥ 0.65 THROTTLE  cap halved
          │                  │  ≥ 0.85 DELAY     + large payouts held 30 min
          │                  │  ≥ 0.95 FREEZE    every payout reverts
          └──────────────────┘
```

### What the oracle checks

| Rule | Catches | Kind |
| :--- | :--- | :--- |
| **Payout vs burn** | Money released that was never burned on the source chain | Proof — scores 1.0 |
| **Size vs baseline** | A release far outside what the route normally does | Estimate |
| **Withdrawal velocity** | A burst that drains the pool under a per-transfer cap | Estimate |
| **Counterparty** | A recipient already tied to a hack or sanctions | Proof, when flagged |
| **Receiving contract** | Money sent to a contract that is unverified, days old and upgradeable, read from the explorer by Retold's contract check | Estimate — alone, at most THROTTLE |

One strong suspicion throttles; two independent ones (a drain-profile contract
*and* an anomalous size or burst) delay; proof freezes.

The first rule catches all three incidents, and it depends only on their
reported mechanism: Verus paid out **965×** the burn; Syscoin and Kelp paid out
against **no verifiable burn at all**.

### Built to fail safe

| The oracle can... | ...so a stolen oracle key means |
| :--- | :--- |
| tighten one route | a slowdown or pause on that route |
| **not** move funds, raise caps, loosen a tier, or resume | never a theft |

- **Every tier expires** after 24 hours. The oracle cannot brick a bridge.
- **Tiers only escalate** while active. A lower score cannot loosen a route.
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
- **Testnet only, and a demo bridge.** Both ends of the bridge are on Sepolia,
  the attack is scripted, and the route's baseline is a fixed demo profile
  rather than one computed from live history.
- **One signer.** The attestation key is the single point of trust (on the
  testnet it is also the deployer). Threshold signing (2-of-3) is the roadmap
  answer; the owner can rotate the oracle key today.

## Proof it works

| Check | Result |
| :--- | :--- |
| Guardian executed in a real EVM | 53 / 53 tests |
| Each tier property broken on purpose (`npm run test:mutants`) | 14 / 14 mutants caught |
| Oracle and contract agree at every tier boundary (64/65, 84/85, 94/95) | 12 cross-layer tests |
| Incident replays, end to end | 41 tests |
| Watch → attest → guardian loop, tier asserted after each step | 6 tests |
| Signed release gate: field/domain binding, replay/order, expiry, key rotation, terminal rejection, required protection | 23 tests |
| Watcher retry, missing/conflicting source data, deduplication and acknowledgement | 11 tests |
| RPC/decode cursor recovery, bounded catch-up and old-deployment refusal | 4 tests |
| Durable state, SIGKILL, transaction inclusion/finality recovery and HOLD/delay queue | 48 tests |
| Finalized log/provenance, canonical headers/checkpoints, receipt finality and signing guard | 20 tests |
| Check before you sign, incl. "nothing reachable from /check can sign" | 40 tests |
| Gas: check an outflow · accept an attestation | 36.7k · 84.5k |
| Total | **414 tests passing** |

The dashboard runs the exact contract bytecode the tests run, and a test fails
if they ever differ.

## Run it locally

```bash
git clone https://github.com/shokkanuly/Chainstory.git
cd Chainstory
npm install
npm run dev                    # Retold at /app and /check, Tripwire at /tripwire
npm test                       # 414 tests
npm run tripwire:demo:local    # the four-step attack, in a local EVM
```

No API keys needed for the Tripwire replay or the local demo. Retold needs an `ETHERSCAN_API_KEY` for live wallet data — see [`.env.example`](.env.example). AI descriptions are off unless you switch them on in the app.

## Repository

| Path | What |
| :--- | :--- |
| [`src/tripwire/`](src/tripwire/) | Risk oracle and the in-browser guardian |
| [`src/tripwire/replay/`](src/tripwire/replay/) | The three incidents and the replay engine |
| [`src/components/tripwire/`](src/components/tripwire/) | The `/tripwire` dashboard |
| [`contracts/evm/`](contracts/evm/) | TripwireGuardian in Solidity, its tests, and the testnet demo contracts |
| [`scripts/tripwire/`](scripts/tripwire/) | The watcher, the attestor, the scripted attack, and the Sepolia deploy / verify / demo |
| [`src/services/preSignCheck.ts`](src/services/preSignCheck.ts) | Check before you sign, at `/check` |
| [`src/pages/Workspace.tsx`](src/pages/Workspace.tsx) | Retold, the wallet analyser at `/app` |
| [`src/services/`](src/services/) | Retold's indexing, decoding, tax engine and risk checks |
| [`api/`](api/), [`server/`](server/) | Retold's API proxy — keeps explorer keys server-side |

Tripwire's oracle reuses Retold's contract checks (verification, age,
upgradeability) to score the contract a payout goes to. Using Retold's indexing
to build live route baselines is next.

## Built vs roadmap

| | Built and tested | Roadmap |
| :--- | :--- | :--- |
| Retold | Wallet stories, draft Form 8949, approvals, contract risk, Check before you sign, opt-in AI wording | Solana analysis in the app (adapters exist, not wired in) |
| Tripwire oracle | Five rules, graduated tiers, `indeterminate` when blind | Baselines from live history; a trained model |
| Guardian | THROTTLE / DELAY / FREEZE, escalate-only, 24 h expiry, on Sepolia | Mainnet; a Solana (Anchor) guardian |
| Operations | Watcher and single-signer attestor, local and on Sepolia | 2-of-3 threshold signing; a relayer / mempool hook |
| Further ideas | — | zkML proofs of the score (EZKL), a sentinel network, bounties for reporters |

## Sources

Checked 25 September 2026.

- [Chainalysis — KelpDAO bridge exploit](https://www.chainalysis.com/blog/kelpdao-bridge-exploit-april-2026/)
- [The Crypto Times — Bridge hacks top $328M in 2026](https://www.cryptotimes.io/2026/05/18/crypto-bridge-hacks-top-328m-in-2026-as-cross-chain-exploits-accelerate/)
- [Syscoin — Technical postmortem](https://syscoin.org/news/technical-postmortem-syscoin-bridge-incident-recovery-and-remediation)

## License

MIT
