# ⛓️ ChainStory — Multi-Chain Plain-English Tax & Pre-Sign Security Engine

**ChainStory** translates cryptic, hexadecimal blockchain transaction logs into human-readable plain-English narratives, auto-calculates IRS Form 8949 compliant FIFO cost-basis tax reports, and provides B2B pre-sign transaction security simulations.

Built for accelerators, incubators, and hackathons, ChainStory moves beyond simple "AI wrappers" by deploying a **decoupled 3-stage local ML + LLM pipeline**, an **unthrottled DefiLlama + IndexedDB price oracle**, and **multi-chain EVM indexers**.

---

## 🌟 Key Product Pillars & Core Capabilities

### 1. 🌐 Multi-Chain EVM Ingestion Layer
- **Multi-Chain Support**: Index transactions across **Ethereum Mainnet, Arbitrum One, Base L2, Optimism, and Polygon PoS**.
- **Internal Smart Contract Log Parsing**: Decodes internal transfers (`txlistinternal`), multi-hop DEX swaps, Aave liquidations, and Lido staking claims.
- **ENS Resolution & Multi-Wallet Batching**: Resolves `.eth` names via ENS and processes batch wallet portfolios.

### 2. ⚡ DefiLlama Historical Oracle & Persistent IndexedDB Cache
- **Rate-Limit Free Pricing**: Replaces throttled CoinGecko endpoints with DefiLlama's historical price API (`coins.llama.fi`).
- **Browser IndexedDB Cache**: Caches timestamped asset prices in client-side IndexedDB (`chainstory_db`) to guarantee **0ms latency** on repeated lookups and zero 429 rate-limiting errors.

### 3. 🤖 Decoupled 3-Stage Local ML + LLM Architecture
- **Stage 1 — Feature Extractor (`featureExtractor.ts`)**: Pure TypeScript module extracting 10 tabular parameters (method signatures, gas, protocol groups, contract age) per transaction.
- **Stage 2 — In-Browser ONNX ML Classifier (`mlClassifier.ts`)**: Runs an XGBoost classifier directly in the browser via `onnxruntime-web` for instantaneous local category assignment (`trade`, `income`, `transfer`, `nft`) at 1ms latency.
- **Stage 3 — Natural Language Summary Generator (`descriptionGenerator.ts`)**: Calls Google Gemini 1.5 Flash with the pre-classified category context to generate concise 1-sentence descriptions.

### 4. 🧾 IRS Form 8949 & 2026 1099-DA FIFO Tax Engine
- **Strict Per-Wallet FIFO Accounting**: Calculates acquisition lots, sale proceeds, and short-term vs. long-term capital gains/losses.
- **Deductible Gas Expense Breakdown**: Tracks network transaction gas fees and deducts them as capital loss adjustments.
- **Tax-Ready CSV Export**: Downloads detailed Form 8949 compliant reports formatted for CPAs and tax software.

### 5. 🛡️ B2B Pre-Sign Transaction Security Simulation API (`@chainstory/core`)
- **Pre-Sign Security Warning**: Simulates raw `eth_sendTransaction` payloads before signing in Web3 browser wallets.
- **Risk Mitigation**: Flags unlimited ERC-20 allowances, unverified contracts, high ETH values, and dangerous protocol interactions.

---

## ⚙️ System Architecture

```
                  ┌─────────────────────────────────────────┐
                  │         CHAINSTORY ARCHITECTURE         │
                  └────────────────────┬────────────────────┘
                                       │
     ┌─────────────────────────────────┼─────────────────────────────────┐
     ▼                                 ▼                                 ▼
┌──────────────────┐         ┌──────────────────┐              ┌──────────────────┐
│  Multi-Chain     │         │ DefiLlama &      │              │ Decoupled        │
│  Ingestion Engine│         │ IndexedDB Cache  │              │ 3-Stage ML/AI    │
│  (EVM RPC / ABI) │         │ (0ms Latency)    │              │ (ONNX + Gemini)  │
└────────┬─────────┘         └────────┬─────────┘              └────────┬─────────┘
         │                            │                                 │
         └────────────────────────────┼─────────────────────────────────┘
                                      ▼
                       ┌──────────────────────────────┐
                       │  FIFO Tax Accounting Engine  │
                       │  (Form 8949 & 1099-DA CSV)   │
                       └──────────────────────────────┘
```

---

## 🛠️ Project Structure

```
src/
├── services/
│   ├── abiDecoder.ts            # Local ABI selector matching & event log parser
│   ├── b2bSimulation.ts         # Pre-sign transaction narrative & risk simulation API
│   ├── classifier.ts            # Orchestrator chaining Feature Extractor -> ML -> Gemini
│   ├── coingecko.ts             # Oracle gateway with DefiLlama fallback
│   ├── defillama.ts             # DefiLlama historical pricing oracle API
│   ├── descriptionGenerator.ts  # Gemini 1.5 Flash natural language summary generator
│   ├── etherscan.ts             # Ethereum mainnet fetcher & demo wallet mock fallback
│   ├── featureExtractor.ts      # Tabular feature extraction for ONNX model
│   ├── fifoEngine.ts            # IRS Form 8949 / 1099-DA FIFO tax calculation engine
│   ├── indexedDbCache.ts        # Browser IndexedDB storage wrapper
│   ├── mlClassifier.ts          # In-browser XGBoost classification via ONNX Runtime Web
│   ├── multiChain.ts            # Multi-chain indexer for Ethereum, Arbitrum, Base, OP, Polygon
│   ├── protocolRegistry.ts      # Known protocol contract address registry
│   └── web3Wallet.ts            # Web3 browser wallet (MetaMask) connector
├── components/
│   ├── ExportButton.tsx         # Form 8949 CSV exporter
│   ├── TaxDashboard.tsx         # Realized gain/loss & tax metrics dashboard
│   ├── TransactionCard.tsx      # Timeline card with confidence meter & warnings
│   ├── TransactionTimeline.tsx  # Chronological timeline feed & category filters
│   └── WalletInput.tsx          # Multi-wallet input & preset buttons
├── App.tsx                      # Main application view with multi-chain selector & modals
└── App.css                      # Styling & design system

ml/
├── collect_training_data.py     # Data collector generating silver-standard labels via Gemini
├── train_classifier.py          # XGBoost trainer with wallet-level split & ONNX export
└── requirements.txt             # Python ML dependencies (pandas, scikit-learn, xgboost, skl2onnx)
```

---

## 🚀 How to Run Locally

### 1. Install Frontend Dependencies
```bash
npm install
```

### 2. Setup Environment Variables
Copy `.env.example` to `.env` and fill in your keys:
```env
VITE_ETHERSCAN_API_KEY=your_etherscan_api_key
VITE_GEMINI_API_KEY=your_gemini_api_key
```

### 3. Start Development Server
```bash
npm run dev
```

Open `http://localhost:5173/` in your browser.

---

## 🧠 Training the Local XGBoost ML Model (Optional)

To train or update the in-browser ONNX model:

```bash
cd ml
pip install -r requirements.txt

# 1. Collect training data across diverse wallet buckets
python collect_training_data.py

# 2. Train XGBoost, evaluate with wallet-level splits, and export ONNX
python train_classifier.py
```
The exported model will be written to `models/xgboost_classifier.onnx`.

---

## 📄 License & Disclaimer

*Disclaimer: ChainStory provides AI/ML transaction classification and FIFO lot accounting estimates for informational purposes. It is not official financial or tax advice. Consult a certified crypto tax professional before filing official tax returns.*
