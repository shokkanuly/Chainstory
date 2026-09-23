<p align="center">
  <img src="https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8.1-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Gemini_AI-JSON_Schema-4285F4?logo=google&logoColor=white" alt="Gemini" />
  <img src="https://img.shields.io/badge/Chains-5_EVM_Networks-F6851B?logo=ethereum&logoColor=white" alt="Multi-Chain" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/status-prototype-orange" alt="Status: prototype" />
</p>

# ⛓️ ChainStory

### Wallet Intelligence — understand any wallet's story, taxes, and risk in plain English.

Paste an Ethereum address. Get back a readable history, a draft tax report, a reputation summary, and a risk check — no wallet connection required.

> **Project status: working prototype.** The app builds, runs, and reads real chain data. Parts of it are demo-grade and are called out precisely in [Known Limitations](#known-limitations). Read that section before trusting any number this tool produces — especially the tax output.

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
| **Token Approvals** | Read-only view of `approve()` calls in the wallet's history | Partial — see [#3](#3-the-approvals-panel-mislabels-the-spender) |
| **Draft Tax Engine** | FIFO cost-basis lots, short/long-term holding periods, gas deductions, Form 8949 CSV + PDF | **Known bug — see [#1](#1-the-fifo-engine-misses-eth-for-token-disposals)** |
| **Pre-Scan Risk** | Contract upgradeability, admin keys, and proxy patterns explained in plain English | **Demo-only — see [#2](#2-the-pre-scan-risk-scanner-invents-its-data)** |

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

| Variable | Required | Where to get it |
| :--- | :---: | :--- |
| `VITE_GEMINI_API_KEY` | Recommended | [Google AI Studio](https://aistudio.google.com/app/apikey) (free) |
| `VITE_ETHERSCAN_API_KEY` | **Yes** | [Etherscan](https://etherscan.io/myapikey) (free) |
| `VITE_ARBISCAN_API_KEY` | No | Falls back to Etherscan key |
| `VITE_BASESCAN_API_KEY` | No | Falls back to Etherscan key |
| `VITE_OPTIMISM_API_KEY` | No | Falls back to Etherscan key |
| `VITE_POLYGONSCAN_API_KEY` | No | Falls back to Etherscan key |

> [!WARNING]
> **Without `VITE_ETHERSCAN_API_KEY`, the app does not fail — it shows fabricated demo transactions.**
> `fetchNormalTransactions()` falls back to `generateMockTransactionsForAddress()` when the key is missing **and** when a network request fails. Those synthetic transactions flow into the timeline, the tax dashboard, and the CSV/PDF export with no visual marker. If your results look plausible but wrong, check your key first. Tracked in [Known Limitations #4](#4-missing-api-keys-silently-produce-fake-data).

> [!CAUTION]
> **`VITE_*` variables are compiled into the public JavaScript bundle.** Anything you put in `.env` is readable by every visitor to a deployed build. This is a Vite design constraint, not a bug — but it means you should only ever use free, rate-limited, revocable keys here. Never deploy this with a paid or privileged API key. A production deployment needs a small backend proxy that holds the keys server-side.

---

## Privacy

Everything runs **client-side in the browser**. There is no ChainStory backend, no account, no wallet connection, and no database — your address is never sent to a server we control, because there isn't one.

That is not the same as "nothing leaves your machine." To do its job the browser calls these third parties directly:

| Service | What it receives |
| :--- | :--- |
| Etherscan / Arbiscan / BaseScan / Optimistic Etherscan / PolygonScan | The wallet address you search |
| Google Gemini (`generativelanguage.googleapis.com`) | Transaction metadata — addresses, values, method names — for description generation |
| DefiLlama (`coins.llama.fi`) | Token symbols and timestamps for historical pricing |
| CoinGecko (`api.coingecko.com`) | Token symbols and dates (fallback pricing) |
| enstate.rs | ENS names you enter, for resolution |

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
│   ├── etherscan.ts                # Ethereum fetcher, ENS resolution, 429 backoff, mock fallback
│   ├── multiChain.ts               # 5-chain indexer (ETH, ARB, BASE, OP, POLY)
│   ├── classifier.ts               # Orchestrator: features → ML/rules → description
│   ├── featureExtractor.ts         # 10-param tabular feature extraction per tx
│   ├── mlClassifier.ts             # ONNX Runtime Web inference + rule-based fallback
│   ├── descriptionGenerator.ts     # Gemini JSON Schema + keyword fallback engine
│   ├── abiDecoder.ts               # Local ABI selector matching
│   ├── protocolRegistry.ts         # ~22 known DeFi contract addresses
│   ├── fifoEngine.ts               # FIFO cost-basis accounting  ⚠️ see Known Limitations #1
│   ├── pdfGenerator.ts             # Client-side printable PDF tax report
│   ├── walletIntelligence.ts       # Reputation, age, diversity, counterparty screening
│   ├── preventiveScamScanner.ts    # Token risk assessment  ⚠️ see Known Limitations #2
│   ├── contractRiskExplainer.ts    # Proxy/admin-key explainer (2 addresses hardcoded)
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
├── pages/            Home.tsx, NotFound.tsx
├── types/index.ts    All shared TypeScript interfaces
├── App.tsx           Application shell + analysis orchestration
├── App.css           Design system (OKLCH tokens)
└── main.tsx          Entry point

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

These are verified, reproducible issues in the current commit — not hypotheticals. They are listed here so nobody discovers them the hard way.

#### 1. The FIFO engine misses ETH-for-token disposals

`calculateFifoTaxReport()` derives the asset symbol as `tx.tokenSymbol || 'ETH'`. On an ETH→USDC swap, `tokenSymbol` is `"USDC"`, so the engine tries to retire **USDC** lots using the **ETH** amount. No ETH lot matches, the disposal is dropped, and proceeds are still added to the total — producing a report with proceeds but **zero cost basis**, which overstates taxable gain.

Reproduce it with the repo's own fixture (`npm run validate`, see [Testing](#testing)):

```
totalProceedsUsd : 4000
totalCostBasisUsd: 0
Errors: Expected 1 realized disposal transaction, found 0
```

Related issues in the same function: gas is accrued on **every** transaction including incoming ones the wallet never paid for; the ETH price used for gas is back-derived from the transaction's own `usdValue / ethValue`, which is wrong for token transfers; and `tx.realizedGainLoss` is overwritten inside the lot loop, so a disposal spanning multiple lots only surfaces the last one in the UI.

**Do not file taxes from this output.**

#### 2. The pre-scan risk scanner invents its data

`analyzePreventiveTokenRisk()` has one hardcoded phishing address. For every other address it derives the result from a hash of the address string:

```ts
const hashVal = hashString(cleanAddr);
const ageDays = (hashVal % 290) + 10;
const isVerified = ageDays > 30;
const riskScore = ageDays < 30 ? 65 : 15;
```

It then renders that as *"Verified contract deployed 214 days ago with standard ERC-20 transfer logic."* The contract age, the verification status, and the risk score are all fabricated — no explorer or bytecode lookup happens. A genuinely malicious contract has a ~90% chance of being labelled **safe**.

`contractRiskExplainer.ts` is similar: it returns real analysis for exactly two hardcoded addresses (a Uniswap router and Lido) and a generic "unverified" response for everything else.

**Treat the pre-scan modal as a UI demo, not a security control.**

#### 3. The approvals panel mislabels the spender

In `extractApprovalsFromTransactions()`, `spender` is set to `tx.to`. For an `approve(address spender, uint256 amount)` call, `tx.to` is the **token contract** — the actual spender is the first calldata argument and is never decoded. The panel also never reconciles revocations, so an allowance you already set to zero still appears active.

#### 4. Missing API keys silently produce fake data

Covered in [Environment Variables](#environment-variables) above. The fallback is useful for offline demos but dangerous as a default, because nothing in the UI distinguishes demo data from real chain data.

#### 5. The landing page ships pre-populated mock results

`App.tsx` initialises with `appState = 'done'` and four hardcoded transactions labelled `vitalik.eth`. First-time visitors see a fully rendered timeline and tax dashboard before analysing anything.

#### 6. No automated test suite or CI

There is one fixture-based validation script and no test runner, no `.github/workflows`, and no coverage. The lint pass is clean apart from 11 warnings (unused imports, one `react-hooks/exhaustive-deps`).

#### 7. The bundle ships a 27 MB WASM runtime for a model that isn't there

`onnxruntime-web` pulls in `ort-wasm-simd-threaded.jsep.wasm` (26.8 MB raw / 6.4 MB gzipped) even though `public/models/xgboost_classifier.onnx` is not committed, so inference always falls back to rules. Until a model ships, importing ONNX lazily behind a real feature flag would cut the production bundle by roughly 95%.

#### 8. Duplicated constants

`METHOD_HINTS` is defined twice with different value vocabularies (`classifier.ts` returns prose like `"ERC-20 approve (authorize spending)"`, `featureExtractor.ts` returns slugs like `"erc20_approve"`). Known protocol addresses are spread across `protocolRegistry.ts`, `contractRiskExplainer.ts`, `etherscan.ts`, `knownWalletValidation.ts`, and `App.tsx`.

---

## Honest Boundaries

Things ChainStory **does not do** — by design, not by accident:

- **Not a live security monitor.** It's read-only and retrospective. It explains what happened; it doesn't intercept transactions.
- **Not tax advice.** Tax output is a DRAFT estimate for review with a qualified CPA. It is not "IRS compliant" or "audit-ready" — and per [Known Limitations #1](#1-the-fifo-engine-misses-eth-for-token-disposals) it is currently incorrect for the most common swap shape.
- **Not a full-chain analytics platform.** It explains *your wallet* to you. It does not score DeFi protocols, audit smart contracts, model impermanent loss, or analyze DAO governance.
- **Classifier is rule-based.** The ONNX model file is not shipped. Classification uses deterministic heuristics, with the ML architecture in place as a hook for future training.
- **Screening lists are small and static.** ~13 flagged addresses and ~22 known protocols are compiled into the bundle. A "clean" result means "not on our short list," not "not on any sanctions list."

Stating these boundaries is intentional. A tool that says what it doesn't do is more trustworthy than one that claims to do everything.

---

## Scripts

```bash
npm run dev       # Start development server (http://localhost:5173)
npm run build     # TypeScript check + Vite production build
npm run preview   # Preview production build locally
npm run lint      # Run oxlint
```

### Testing

There is no test runner yet. The one end-to-end assertion suite runs directly:

```bash
npx tsx src/services/knownWallet.test.ts
```

It checks the story narrative and FIFO CSV output against a fixed three-transaction fixture. **It currently fails** — that failure is the reproduction case for [Known Limitations #1](#1-the-fifo-engine-misses-eth-for-token-disposals). Fixing the asset-symbol bug in `fifoEngine.ts` should make it pass.

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

Ordered by impact, highest first:

1. **Fix the FIFO asset-symbol bug** so `npx tsx src/services/knownWallet.test.ts` passes — then charge gas only to the paying wallet, and keep an array of realized lots per transaction.
2. **Make demo data visible.** Return an explicit `{ source: 'live' | 'demo' }` from the fetch layer and render a banner when it's `demo`, instead of failing open into fabricated transactions.
3. **Make the risk scanner real or label it.** Either query Etherscan's `getsourcecode` + `getcontractcreation` for genuine verification and age, or badge the modal clearly as a demo until then.
4. **Decode approval calldata** to extract the real spender address, and net out revocations.
5. **Add Vitest + a GitHub Actions workflow** running `build`, `lint`, and the fixture suite on every push.
6. **Lazy-load ONNX** behind a runtime check so the 27 MB WASM payload isn't in the default bundle.
7. **De-duplicate `METHOD_HINTS`** and consolidate the address registries into `protocolRegistry.ts`.
8. **Add a backend key proxy** before any public deployment.

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
