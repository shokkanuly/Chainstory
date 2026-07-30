<p align="center">
  <img src="https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8.1-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Gemini_AI-JSON_Schema-4285F4?logo=google&logoColor=white" alt="Gemini" />
  <img src="https://img.shields.io/badge/Chains-5_EVM_Networks-F6851B?logo=ethereum&logoColor=white" alt="Multi-Chain" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

# ⛓️ ChainStory

### Wallet Intelligence — understand any wallet's story, taxes, and risk in plain English.

Paste an Ethereum address. Get back a readable history, a draft tax report, a reputation summary, and a risk check — no wallet connection required.

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

| Capability | What you see |
| :--- | :--- |
| **AI Story Feed** | Every transaction becomes a 1-sentence plain-English description |
| **Wallet Intelligence** | Wallet age, activity frequency, protocol diversity, and a transparent reputation label |
| **Risk Screening** | Counterparty addresses checked against Tornado Cash, sanctioned entities, and known exploit drainers |
| **Token Approvals** | Read-only view of ERC-20 spending permissions you've granted, with unlimited-allowance warnings |
| **Draft Tax Engine** | FIFO cost-basis lots, short/long-term holding periods, gas deductions, and draft Form 8949 CSV + PDF |
| **Pre-Scan Risk** | Before you interact — plain-English explanations of contract upgradeability, admin keys, and proxy patterns |
| **Multi-Chain** | Ethereum, Arbitrum, Base, Optimism, and Polygon from one search bar |

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/shokkanuly/Chainstory.git
cd Chainstory
npm install

# 2. Configure API keys
cp .env.example .env
# Edit .env — add your Gemini and Etherscan keys (both free)

# 3. Run
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and paste any address or ENS name (try `vitalik.eth`).

### Environment Variables

| Variable | Required | Where to get it |
| :--- | :---: | :--- |
| `VITE_GEMINI_API_KEY` | Yes | [Google AI Studio](https://aistudio.google.com/app/apikey) (free) |
| `VITE_ETHERSCAN_API_KEY` | Yes | [Etherscan](https://etherscan.io/myapikey) (free) |
| `VITE_ARBISCAN_API_KEY` | No | Falls back to Etherscan key |
| `VITE_BASESCAN_API_KEY` | No | Falls back to Etherscan key |
| `VITE_OPTIMISM_API_KEY` | No | Falls back to Etherscan key |
| `VITE_POLYGONSCAN_API_KEY` | No | Falls back to Etherscan key |

> **Works without API keys too.** The deterministic keyword fallback engine generates plain-English descriptions for 100% of transactions offline. Gemini makes them better, but isn't required.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                USER INPUT                              │
│                     Paste address / ENS name + pick chain              │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                 ┌──────────────────┼──────────────────┐
                 ▼                  ▼                  ▼
       ┌─────────────────┐ ┌───────────────┐ ┌─────────────────────┐
       │ Multi-Chain      │ │ Price Oracle  │ │ Wallet Intelligence │
       │ Indexer          │ │ DefiLlama +   │ │ Age · Diversity ·   │
       │ 5 EVM networks   │ │ CoinGecko +   │ │ Reputation ·        │
       │ + 429 throttler  │ │ IndexedDB     │ │ Risk Screening      │
       └────────┬─────────┘ └───────┬───────┘ └──────────┬──────────┘
                │                   │                     │
                └───────────────────┼─────────────────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │  Hybrid Classifier            │
                    │  Rule-based heuristics +      │
                    │  Gemini AI (JSON Schema mode) │
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

Everything runs **client-side in the browser**. No backend server, no wallet connection, no data leaves your machine.

---

## Project Structure

```
src/
├── services/
│   ├── etherscan.ts              # Ethereum fetcher + 429 exponential backoff
│   ├── multiChain.ts             # 5-chain indexer (ETH, ARB, BASE, OP, POLY)
│   ├── classifier.ts             # Orchestrator: Feature Extractor → ML → Gemini
│   ├── descriptionGenerator.ts   # Gemini JSON Schema + keyword fallback engine
│   ├── featureExtractor.ts       # 10-param tabular feature extraction per tx
│   ├── mlClassifier.ts           # ONNX Runtime Web classifier (rule fallback)
│   ├── abiDecoder.ts             # Local ABI selector matching & event parser
│   ├── fifoEngine.ts             # IRS Form 8949 FIFO cost-basis accounting
│   ├── pdfGenerator.ts           # Client-side printable PDF tax report
│   ├── walletIntelligence.ts     # Reputation, age, diversity, risk analysis
│   ├── preventiveScamScanner.ts  # Pre-interaction token risk assessment
│   ├── contractRiskExplainer.ts  # Proxy/admin-key plain-English explainer
│   ├── coingecko.ts              # Price oracle + DefiLlama fallback
│   ├── defillama.ts              # Historical price API
│   ├── indexedDbCache.ts         # Browser IndexedDB persistent cache
│   ├── watchlistStore.ts         # LocalStorage wallet watchlist manager
│   ├── protocolRegistry.ts       # Known DeFi protocol address registry
│   ├── b2bSimulation.ts          # Pre-sign tx simulation API
│   └── web3Wallet.ts             # MetaMask/Web3 wallet connector
│
├── components/
│   ├── WalletInput.tsx            # Address input + ENS + chain selector
│   ├── WalletIntelligenceCard.tsx # Reputation + risk summary card
│   ├── TokenApprovalsPanel.tsx    # ERC-20 approvals history panel
│   ├── TaxDashboard.tsx           # Capital gains/income/gas dashboard
│   ├── TransactionTimeline.tsx    # Chronological story feed
│   ├── TransactionCard.tsx        # Individual tx card with confidence
│   ├── ExportButton.tsx           # CSV + PDF export controls
│   ├── ContractRiskModal.tsx      # Pre-scan risk & permissions modal
│   ├── WatchlistModal.tsx         # Saved wallet watchlist UI
│   ├── Navbar.tsx                 # Navigation bar
│   ├── Hero.tsx                   # Landing hero section
│   ├── Features.tsx               # Feature showcase
│   ├── Architecture.tsx           # Architecture diagram section
│   ├── HowItWorks.tsx             # How-it-works explainer
│   ├── Security.tsx               # Security section
│   ├── Footer.tsx                 # Footer with disclaimers
│   └── NetworkTicker.tsx          # Chain selector & stats ticker
│
├── types/index.ts                 # All TypeScript interfaces
├── App.tsx                        # Main application shell
├── App.css                        # Design system & styling
└── main.tsx                       # Entry point

ml/
├── collect_training_data.py       # Silver-label data collection via Gemini
├── train_classifier.py            # XGBoost trainer + ONNX export
└── requirements.txt               # Python ML dependencies
```

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **UI** | React 19, TypeScript 6, Vite 8, TailwindCSS 4, Framer Motion |
| **AI** | Google Gemini Flash (JSON Schema structured output) |
| **Classification** | Rule-based heuristic engine + ONNX Runtime Web fallback architecture |
| **Pricing** | DefiLlama historical API + CoinGecko + browser IndexedDB cache |
| **Chains** | Etherscan API family (Ethereum, Arbiscan, BaseScan, Optimistic Etherscan, PolygonScan) |
| **Exports** | Client-side CSV generator + browser print-to-PDF |

---

## Honest Boundaries

Things ChainStory **does not do** — by design, not by accident:

- **Not a live security monitor.** It's read-only and retrospective. It explains what happened; it doesn't intercept transactions.
- **Not tax advice.** Tax output is a DRAFT estimate for review with a qualified CPA. It is not "IRS compliant" or "audit-ready."
- **Not a full-chain analytics platform.** It explains *your wallet* to you. It does not score DeFi protocols, audit smart contracts, model impermanent loss, or analyze DAO governance.
- **Classifier is rule-based.** The ONNX model file is not shipped. Classification uses deterministic heuristics with the ML architecture as a fallback hook for future training.

Stating these boundaries is intentional. A tool that says what it doesn't do is more trustworthy than one that claims to do everything.

---

## Scripts

```bash
npm run dev       # Start development server (http://localhost:5173)
npm run build     # TypeScript check + Vite production build
npm run preview   # Preview production build locally
npm run lint      # Run oxlint
```

### Training the ML Model (Optional)

```bash
cd ml
pip install -r requirements.txt
python collect_training_data.py   # Collect labeled data via Gemini
python train_classifier.py        # Train XGBoost → export ONNX
# Output: models/xgboost_classifier.onnx
```

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit changes (`git commit -m 'Add my feature'`)
4. Push to branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <em>ChainStory generates a DRAFT Form 8949 / Schedule D estimate for informational purposes only.<br/>
  It does not constitute legal, financial, or tax advice. Review all output with a qualified professional.</em>
</p>
