> **Note:** ChainStory is now the wallet-intelligence engine underneath
> [Tripwire](../README.md). This document covers that engine; it is accurate,
> and the product framing has moved to the root README.

<p align="center">
  <img src="https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8.1-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Gemini_AI-JSON_Schema-4285F4?logo=google&logoColor=white" alt="Gemini" />
  <img src="https://img.shields.io/badge/Chains-5_EVM_Networks-F6851B?logo=ethereum&logoColor=white" alt="Multi-Chain" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/tests-85_passing-brightgreen" alt="Tests" />
  <img src="https://img.shields.io/badge/status-beta-blue" alt="Status: beta" />
</p>

# ⛓️ ChainStory

### Wallet Intelligence — understand any wallet's story, taxes, and risk in plain English.

Paste an Ethereum address. Get back a readable history, a draft tax report, a reputation summary, and a risk check — no wallet connection required.

> **Project status: beta.** The app builds clean, lints clean, and passes 85 tests. Chain reads, tax accounting, approval decoding and contract risk lookups all hit real data. What it still does *not* cover is listed honestly in [Known Limitations](#known-limitations) — read it before filing anything based on the tax output.

---

## The Problem

Block explorers show you this:

```
0x7ff36ab500000000000000000000000000000000000000000000000000000000...
Function: swapExactETHForTokens(uint256,address[],address,uint256)
Value: 2000000000000000000 wei
```

ChainStory shows you this:

> **"Swapped 2.0 ETH for 3,400 USDC on Uniswap V3"**

Raw on-chain data is machine-readable but human-incomprehensible. Most blockchain usability, tax, and risk problems stem from that single root cause. ChainStory solves the translation layer once — and that one pipeline powers readable history, draft tax accounting, wallet reputation scoring, and counterparty risk screening together.

---

## What It Does

| Capability | What you see | Maturity |
| :--- | :--- | :--- |
| **AI Story Feed** | Every transaction becomes a 1-sentence plain-English description | Working |
| **Multi-Chain Indexing** | Ethereum, Arbitrum, Base, Optimism, and Polygon from one search bar | Working |
| **Wallet Intelligence** | Wallet age, activity frequency, contract diversity, and a transparent reputation label | Working |
| **Counterparty Screening** | Addresses checked against a bundled list of ~13 known mixer / sanctioned / exploit addresses | Working, narrow |
| **Demo-data labelling** | A banner whenever displayed figures are synthetic rather than real chain data | Working |
| **Token Approvals** | Outstanding ERC-20 allowances, decoded from calldata, with revocations netted out | Working |
| **Draft Tax Engine** | FIFO cost-basis lots, short/long-term holding periods, gas deductions, Form 8949 CSV + PDF | Working — draft only |
| **Pre-Scan Risk** | Real verification status, deployment age, proxy pattern and ABI-derived admin powers | Working — needs an API key |

---

## Quick Start

```bash
git clone https://github.com/shokkanuly/Chainstory.git
cd Chainstory
npm install
cp .env.example .env    # then add your keys — see below
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and paste any address or ENS name (try `vitalik.eth`).

### Environment Variables

All keys are **server-side**. They are read by the `/api` proxy functions and are
never sent to the browser.

| Variable | Required | Where to get it |
| :--- | :---: | :--- |
| `ETHERSCAN_API_KEY` | **Yes** for live data | [Etherscan](https://etherscan.io/myapikey) (free) |
| `GEMINI_API_KEY` | No | [Google AI Studio](https://aistudio.google.com/app/apikey) (free) |
| `ARBISCAN_API_KEY` | No | Falls back to `ETHERSCAN_API_KEY` |
| `BASESCAN_API_KEY` | No | Falls back to `ETHERSCAN_API_KEY` |
| `OPTIMISM_API_KEY` | No | Falls back to `ETHERSCAN_API_KEY` |
| `POLYGONSCAN_API_KEY` | No | Falls back to `ETHERSCAN_API_KEY` |

> [!IMPORTANT]
> **Do not add a `VITE_` prefix to these.** That prefix is what inlines a value
> into the public client bundle, where anyone can read it. It is the reason this
> proxy exists. `npm run build && grep -r "apikey=" dist/` should return nothing.

> [!NOTE]
> **Without `ETHERSCAN_API_KEY` the app runs on demo data, and says so.** The
> proxy answers 503, the fetch layer returns `source: 'demo'`, every synthetic
> record is flagged `isDemo`, and the workspace shows an amber banner naming the
> reason. Contract risk lookups return `unknown` rather than a guess.

### Deploying

The app is a static SPA plus two serverless functions, so any host that runs
both works. Vercel needs no extra configuration beyond the keys:

```bash
npm i -g vercel
vercel                                    # link the project
vercel env add ETHERSCAN_API_KEY          # paste the key, choose all environments
vercel env add GEMINI_API_KEY             # optional
vercel --prod
```

`vercel.json` already sets the build command, the SPA rewrite and `no-store` on
`/api/*`. Local `npm run dev` runs the same handlers through a Vite middleware
plugin, so development and production share one code path.

---

## Privacy

Analysis runs **client-side in the browser**. The only server-side code is a
thin proxy that holds the API keys and forwards allowlisted explorer requests;
it stores nothing. There is no account, no wallet connection, and no database — your address is never sent to a server we control, because there isn't one.

That is not the same as "nothing leaves your machine." To do its job the browser calls these third parties directly:

| Service | What it receives |
| :--- | :--- |
| Etherscan / Arbiscan / BaseScan / Optimistic Etherscan / PolygonScan | The wallet address you search |
| Google Gemini (`generativelanguage.googleapis.com`) | Transaction metadata — addresses, values, method names — for description generation |
| DefiLlama (`coins.llama.fi`) | Token symbols and timestamps for historical pricing |
| CoinGecko (`api.coingecko.com`) | Token symbols and dates (fallback pricing) |

If you want zero third-party AI exposure, leave `VITE_GEMINI_API_KEY` unset — the deterministic keyword fallback generates descriptions for 100% of transactions offline, and no transaction data reaches Google.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                USER INPUT                               │
│                     Paste address / ENS name + pick chain               │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                 ┌──────────────────┼──────────────────┐
                 ▼                  ▼                  ▼
       ┌─────────────────┐ ┌───────────────┐ ┌─────────────────────┐
       │ Multi-Chain     │ │ Price Oracle  │ │ Wallet Intelligence │
       │ Indexer         │ │ DefiLlama +   │ │ Age · Diversity ·   │
       │ 5 EVM networks  │ │ CoinGecko +   │ │ Reputation ·        │
       │ + 429 throttler │ │ IndexedDB     │ │ Risk Screening      │
       └────────┬────────┘ └───────┬───────┘ └──────────┬──────────┘
                │                  │                    │
                └──────────────────┼────────────────────┘
                                   ▼
                    ┌───────────────────────────────┐
                    │  Hybrid Classifier            │
                    │  Rule-based heuristics +      │
                    │  Gemini AI (JSON Schema mode) │
                    │  ONNX hook (model not shipped)│
                    └───────────────┬───────────────┘
                                    ▼
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
    ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
    │ Story Feed       │  │ FIFO Tax Engine  │  │ Pre-Scan Risk    │
    │ Plain-English    │  │ Draft Form 8949  │  │ Contract Proxy + │
    │ per transaction  │  │ CSV + PDF export │  │ Admin Key Check  │
    └──────────────────┘  └──────────────────┘  └──────────────────┘
```

### Classification pipeline

`classifier.ts` orchestrates three stages per transaction:

1. **Feature extraction** (`featureExtractor.ts`) — 10 tabular features: method selector, direction, ETH value, USD value, gas used, token-transfer flag, protocol group, calldata length, failure flag, known-contract flag.
2. **Categorisation** — tries `classifyWithML()` (ONNX) first, falls back to `classifyWithRules()`. **In this repo the ONNX branch never runs** — `public/models/xgboost_classifier.onnx` is not committed, so every classification comes from the rule engine.
3. **Description** (`descriptionGenerator.ts`) — Gemini in JSON Schema mode, with a deterministic keyword fallback that covers every transaction.

Concurrency is capped at 3 in-flight Gemini calls; Etherscan calls are throttled to 4/sec with exponential backoff on HTTP 429.

---

## Project Structure

```
src/
├── services/                       # All logic lives here — components are presentational
│   ├── chains.ts                   # Dependency-free EVM chain registry
│   ├── assetResolver.ts            # Single source of truth: which asset moved, how much
│   ├── methodRegistry.ts           # One selector table — machine slug + human label
│   ├── etherscan.ts                # Ethereum fetcher, ENS resolution, 429 backoff, demo fallback
│   ├── multiChain.ts               # 5-chain indexer (ETH, ARB, BASE, OP, POLY)
│   ├── classifier.ts               # Orchestrator: features → ML/rules → description
│   ├── featureExtractor.ts         # 10-param tabular feature extraction per tx
│   ├── mlClassifier.ts             # ONNX Runtime Web inference + rule-based fallback
│   ├── descriptionGenerator.ts     # Gemini JSON Schema + keyword fallback engine
│   ├── abiDecoder.ts               # Local ABI selector matching
│   ├── protocolRegistry.ts         # ~22 known DeFi contract addresses
│   ├── fifoEngine.ts               # FIFO cost-basis accounting
│   ├── taxSummary.ts               # Dashboard aggregates
│   ├── tokenApprovals.ts           # Outstanding allowances, revocations netted out
│   ├── contractIntel.ts            # Real explorer lookups: verification, age, proxy, ABI
│   ├── pdfGenerator.ts             # Client-side printable PDF tax report
│   ├── walletIntelligence.ts       # Reputation, age, diversity, counterparty screening
│   ├── preventiveScamScanner.ts    # Token risk scoring from real signals
│   ├── contractRiskExplainer.ts    # Proxy / admin-key explainer, ABI-derived
│   ├── b2bSimulation.ts            # Pre-sign tx simulation API
│   ├── coingecko.ts                # Price oracle facade
│   ├── defillama.ts                # Historical price API
│   ├── indexedDbCache.ts           # Browser IndexedDB persistent price cache
│   ├── watchlistStore.ts           # LocalStorage wallet watchlist
│   ├── web3Wallet.ts               # MetaMask/EIP-1193 connector
│   ├── knownWalletValidation.ts    # End-to-end fixture assertions
│   ├── knownWallet.test.ts         # Runner for the above (see Testing)
│   └── stressTestRunner.ts         # Edge-case wallet harness
│
├── components/
│   ├── WalletInput.tsx             # Address input + ENS + chain selector
│   ├── TransactionTimeline.tsx     # Chronological story feed
│   ├── TransactionCard.tsx         # Individual tx card with confidence
│   ├── WalletIntelligenceCard.tsx  # Reputation + risk summary
│   ├── TokenApprovalsPanel.tsx     # ERC-20 approvals history
│   ├── TaxDashboard.tsx            # Capital gains / income / gas dashboard
│   ├── ExportButton.tsx            # CSV + PDF export controls
│   ├── ContractRiskModal.tsx       # Pre-scan risk & permissions modal
│   ├── WatchlistModal.tsx          # Saved wallet watchlist
│   ├── NetworkTicker.tsx           # Chain selector & stats ticker
│   ├── ui/                         # card.tsx, button.tsx primitives
│   └── …                           # Landing sections: Hero, Features, Architecture,
│                                   # HowItWorks, Security, Pricing, Services,
│                                   # Portfolio, Testimonials, Contact, CTA, Footer
│
├── prototype/        v2 app shell at /v2, see docs/design-v2.md
│   ├── tokens.css                Scoped design tokens
│   ├── PrototypeApp.tsx          Shell: rail, top bar, tabs
│   ├── panels.tsx                Activity, taxes, approvals, risk
│   ├── primitives.tsx            Avatar, chain mark, pills
│   ├── format.ts                 Address and currency formatters
│   └── sampleData.ts             Demo wallet
│
├── pages/            Home.tsx, NotFound.tsx
├── types/index.ts    All shared TypeScript interfaces
├── App.tsx           Application shell + analysis orchestration
├── App.css           Design system (OKLCH tokens)
└── main.tsx          Entry point

server/                             # API key proxy, no state
├── explorerHandler.ts              # Allowlisted explorer proxy + rate limit
├── geminiHandler.ts                # Prompt built server-side, not client-supplied
├── devPlugin.ts                    # Runs the same handlers in `npm run dev`
└── __tests__/                      # Allowlist and key-handling tests

api/                                # Vercel adapters over server/
├── explorer.ts
└── describe.ts

ml/
├── collect_training_data.py        # Gemini-labelled ("silver standard") dataset builder
├── train_classifier.py             # XGBoost trainer + ONNX export
└── requirements.txt                # pandas, scikit-learn, xgboost, requests, onnxmltools, skl2onnx
```

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **UI** | React 19, TypeScript 6, Vite 8, TailwindCSS 4, Framer Motion |
| **AI** | Google Gemini Flash (JSON Schema structured output) |
| **Classification** | Rule-based heuristic engine; ONNX Runtime Web hook (model not shipped) |
| **Pricing** | DefiLlama historical API + CoinGecko fallback + IndexedDB cache |
| **Chains** | Etherscan API family (Ethereum, Arbiscan, BaseScan, Optimistic Etherscan, PolygonScan) |
| **Exports** | Client-side CSV generator + browser print-to-PDF |
| **Lint** | oxlint |

---

## Known Limitations

Verified, reproducible, and current. Everything here is a real constraint, not a hypothetical.

#### 1. Tax output is a draft, and the window is 100 transactions

The FIFO engine is correct for the cases it can see, but it only sees the most recent 100 transactions per wallet. A disposal whose acquisition predates that window has no matching lot, so its cost basis is unknown. The engine reports these as `unmatchedDisposalCount` rather than booking them at zero basis, and the dashboard warns that the gain shown is an upper bound — but the number is still incomplete. Paginating the full history is the fix.

#### 2. Token cost basis depends on price coverage

Historical prices come from DefiLlama with a CoinGecko fallback, and the symbol map covers ~15 major assets. A long-tail token resolves to `null`, which the dashboard surfaces as "price data unavailable for N transaction(s)". Those transactions contribute no proceeds and no basis.

#### 3. Contract risk reads metadata, not logic

`contractIntel.ts` reports genuine facts — verification status, deployment date, proxy flag, implementation address, and admin capabilities parsed from the verified ABI. That is a real signal, but it is **not an audit**. It does not analyse contract logic, detect honeypots, or simulate execution. A contract with a clean ABI can still be malicious. Without an explorer API key every field returns `unknown`, which the UI renders as unknown rather than as "no".

#### 4. Screening lists are small and static

~13 flagged addresses and ~22 known protocols compiled into the bundle. A "clean" result means "not on our short list," not "not on any sanctions list."

#### 5. The classifier is rule-based

`public/models/xgboost_classifier.onnx` is not committed, so `classifyWithML()` never runs and every category comes from `classifyWithRules()`. The app now HEAD-probes for the model before importing `onnxruntime-web`, so the ~27 MB WASM runtime is no longer downloaded when there is nothing to run — but `onnxruntime-web` is still a dependency, so it still appears in `dist/`. Dropping the dependency entirely is what shrinks the build artifact.

#### 6. The landing page shows sample data

`App.tsx` initialises with four hardcoded transactions labelled `vitalik.eth` so the workspace is not empty on arrival. They are flagged `isDemo` and covered by the demo banner, so they are labelled rather than disguised — but they are still not your wallet until you search.

#### 7. Approvals are limited to the fetched window

An allowance granted before the 100-transaction window will not appear, and the panel reads transaction history rather than querying live `allowance()` state. It is an accurate reading of what it can see, not a complete picture of what is currently approved on-chain.

#### 8. Rate limiting is per-instance

The proxy limits each IP to 60 requests/minute, but the counter lives in memory,
so it resets when a serverless instance recycles and is not shared across
instances. That stops casual scraping; a determined attacker would need a shared
store such as Redis or Vercel KV.

---

## Honest Boundaries

Things ChainStory **does not do** — by design, not by accident:

- **Not a live security monitor.** It's read-only and retrospective. It explains what happened; it doesn't intercept transactions.
- **Not tax advice.** Tax output is a DRAFT estimate for review with a qualified CPA. It is not "IRS compliant" or "audit-ready", and it is bounded by the 100-transaction fetch window described in [Known Limitations #1](#1-tax-output-is-a-draft-and-the-window-is-100-transactions).
- **Not a full-chain analytics platform.** It explains *your wallet* to you. It does not score DeFi protocols, audit smart contracts, model impermanent loss, or analyze DAO governance.
- **Classifier is rule-based.** The ONNX model file is not shipped. Classification uses deterministic heuristics, with the ML architecture in place as a hook for future training.
- **Risk analysis is metadata, not audit.** It reads what the explorer publishes. A clean reading is not a safety guarantee.
- **Screening lists are small and static.** ~13 flagged addresses and ~22 known protocols are compiled into the bundle. A "clean" result means "not on our short list," not "not on any sanctions list."

Stating these boundaries is intentional. A tool that says what it doesn't do is more trustworthy than one that claims to do everything.

---

## Scripts

```bash
npm run dev        # Start development server (http://localhost:5173)
                   #   /    current UI
                   #   /v2  redesigned app shell (prototype)
npm run build      # TypeScript check + Vite production build
npm run preview    # Preview production build locally
npm run lint       # Run oxlint
npm test           # Run the Vitest suite
npm run test:watch # Vitest in watch mode
npm run validate   # Run just the end-to-end wallet fixture suite
```

### Testing

85 tests across six suites, run by `npm test`:

| Suite | Covers |
| :--- | :--- |
| `services/__tests__/fifoEngine.test.ts` | Asset resolution on swaps, gas charged to the sender only, gas priced from the native rate, multi-lot disposals, unmatched cost basis, the 365-day holding boundary, per-asset lot queues |
| `services/__tests__/assetResolver.test.ts` | Wei vs. token-decimal scaling, non-18-decimal tokens, chain-native symbols, malformed input |
| `services/__tests__/approvals.test.ts` | `approve()` calldata decoding, unlimited detection, revocation netting, per-spender tracking, ignoring third-party approvals |
| `services/knownWallet.test.ts` | End-to-end: story narrative, FIFO report and Form 8949 CSV over a fixed three-transaction fixture |

CI runs `lint`, `build` and `test` on every push and pull request — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

### Training the ML Model (Optional)

```bash
cd ml
pip install -r requirements.txt
export GEMINI_API_KEY=...            # used to generate labels
python collect_training_data.py      # → data/labeled_dataset.csv
python train_classifier.py           # → models/xgboost_classifier.onnx
```

Then copy the `.onnx` output to `public/models/` so `mlClassifier.ts` can load it at `/models/xgboost_classifier.onnx`.

> Labels are generated by Gemini, not by human annotators or ground truth. Reported accuracy is therefore agreement with an LLM's opinion — treat it as a smoke test of feature quality, not as a measure of real-world correctness.

---

## Roadmap

Shipped:

- [x] FIFO asset-symbol fix — ETH-for-token swaps now match their lots
- [x] Gas charged to the sender only, priced from the native rate
- [x] Multi-lot disposals emit one row per lot; unmatched basis flagged, not zeroed
- [x] Demo data labelled everywhere it appears instead of failing open
- [x] Contract risk reads real explorer data; unknown reported as unknown
- [x] Approval calldata decoded for the true spender, revocations netted out
- [x] ONNX runtime no longer downloaded when no model is deployed
- [x] Vitest suite (85 tests) + GitHub Actions CI
- [x] `METHOD_HINTS` and chain configs de-duplicated

Next, by impact:

1. **Paginate beyond 100 transactions** so cost basis covers full wallet history — the largest remaining source of tax inaccuracy.
2. **Query live `allowance()` state** instead of inferring approvals from history, so the panel reflects on-chain truth.
3. **Widen price coverage** past the ~15-symbol map, with a token-address-based lookup.
4. **Train and ship the ONNX model**, or drop `onnxruntime-web` to shrink the build artifact.
5. **Add a backend key proxy** before any public deployment.
6. **Expand the screening list**, ideally from a maintained source rather than a compiled-in constant.

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Run `npm run build && npm run lint` before committing
4. Commit changes (`git commit -m 'Add my feature'`)
5. Push to branch (`git push origin feature/my-feature`)
6. Open a Pull Request

---

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center">
  <em>ChainStory generates a DRAFT Form 8949 / Schedule D estimate for informational purposes only.<br/>
  It does not constitute legal, financial, or tax advice. Review all output with a qualified professional.</em>
</p>
