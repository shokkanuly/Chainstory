# 🏆 ChainStory — Hackathon Official Submission Entry

**Project Title**: ⛓️ ChainStory  
**Tagline**: Wallet Intelligence — Understand Any Wallet's Story, Draft Taxes, and Risk in Plain English.  
**Track**: AI & Data Accessibility / Infrastructure & Tooling  
**Live Demo URL**: [http://localhost:5173/](http://localhost:5173/)  
**GitHub Repository**: [https://github.com/shokkanuly/Chainstory](https://github.com/shokkanuly/Chainstory)  

---

## 🎯 1. Executive Summary & The WOW Moment

Most blockchain usability, tax compliance, and risk problems stem from one single root cause:
> **Raw on-chain data is machine-readable but human-incomprehensible.**

Block explorers present raw hex, method selectors (`0x7ff36ab5`), wei values, and gas fields — leaving everyday users unable to understand what happened, what an asset was worth at execution time, whether it triggers a capital gain, or whether a counterparty is dangerous.

### The WOW Moment (Before vs. After):
- **BEFORE (Block Explorer)**:
  `0x7ff36ab50000000000000000000000000000000000000000000000000000000000000002`
- **AFTER (ChainStory AI Story Engine)**:
  *"Swapped 2.0 ETH for 3,400 USDC on Uniswap V3 Router"*

By solving the **on-chain translation layer once**, ChainStory unlocks **Readability**, **Draft Tax Accounting**, **Wallet Reputation**, **Counterparty Risk Screening**, and **Approvals Transparency** under **one single pipeline**.

---

## 🛠️ 2. Key Features & Shipped Capabilities

### 1. 📖 AI Plain-English Story Feed
- Translates EVM log parameters into 1-sentence plain-English descriptions using Google Gemini (JSON Schema mode) backed by an offline deterministic keyword fallback parser guaranteeing **100% description coverage**.

### 2. 🧾 Draft Form 8949 / Schedule D Tax Engine
- Multi-category classification (`trade`, `income`, `transfer`, `nft`), historical price resolution via DefiLlama + CoinGecko + IndexedDB, and strict FIFO cost-basis accounting with 1-click **CSV** and printable **PDF Tax Report** exports.

### 3. 🧠 Wallet Intelligence Reputation Card
- Computes wallet creation age, active duration, transaction frequency, and protocol diversity. Generates transparent heuristic reputation summaries (*Established Veteran*, *DeFi Explorer*, *Regular Active*, *Newly Created*).

### 4. 🛡️ Counterparty Risk Screening
- Screens counterparty addresses against a curated database of known mixers (Tornado Cash), sanctioned entities, and exploit drainers. Displays green *"No Flagged Interactions"* or amber warning badges.

### 5. 🔑 Token Approvals History Panel
- Surfacing past granted ERC-20 spending permissions in plain English and highlighting unlimited allowances for user security awareness.

### 6. 🔍 Phase 2 Pre-Scan Risk & Permissions Scanner
- Interactive pre-interaction risk scanner analyzing token contract age, verification status, and proxy upgradeability (EIP-1967 Transparent Proxy / Minimal Proxy) with plain-English permission explanations.

---

## 📊 3. The 14-Problem Scorecard

| # | Problem | Tier | ChainStory's Answer | Implementation Status |
| :-: | :--- | :---: | :--- | :---: |
| **1** | Wallets terrifying for newcomers (raw tx data) | ✅ **SOLVED** | Retrospective plain-English story narrative feed for every transaction | **Built & Verified** |
| **2** | No plain-language transparency of approvals | 🔧 **ADDED** | Read-only Token Approvals panel surfacing granted ERC-20 approvals & flagging unlimited allowances | **Built & Verified** |
| **3** | Scam / rug-pull detection is reactive | 🔮 **PHASE 2** | Pre-transaction warnings before purchasing unverified tokens | **Built (Pre-Scan Scanner)** |
| **4** | Wallet risk scoring is opaque (sanctions/mixers) | 🔧 **ADDED** | Counterparty risk database screening (Tornado Cash, sanctioned entities, drainers) with warning badges | **Built & Verified** |
| **5** | DeFi protocol risk hard to assess | ⛔ **DECLINE** | Deliberately out of scope — requires protocol TVL & audit pipeline | **Out of Scope (By Choice)** |
| **6** | Impermanent loss / yield risk poorly communicated | ⛔ **DECLINE** | Deliberately out of scope — requires real-time LP position modeling | **Out of Scope (By Choice)** |
| **7** | Cross-chain bridge vulnerability risk | ⛔ **DECLINE** | Deliberately out of scope — requires bridge security monitoring | **Out of Scope (By Choice)** |
| **8** | DAO voter apathy | ⛔ **DECLINE** | Deliberately out of scope — requires governance platform integration | **Out of Scope (By Choice)** |
| **9** | Governance capture by whales | ⛔ **DECLINE** | Deliberately out of scope — governance analytics product | **Out of Scope (By Choice)** |
| **10** | On-chain data unreadable | ✅ **SOLVED** | AI story engine (Gemini JSON Schema mode + deterministic keyword fallback) | **Built & Verified** |
| **11** | Tax reporting nightmare | ✅ **SOLVED** | Auto-categorization + historical pricing + FIFO lot engine + draft Form 8949 CSV/PDF | **Built & Verified** |
| **12** | Fragmented identity / reputation | 🔧 **ADDED** | Wallet Intelligence summary card (age, activity, protocol count, transparent reputation summary) | **Built & Verified** |
| **13** | Smart contract auditing expensive & slow | ⛔ **DECLINE** | Deliberately out of scope — source-level code security discipline | **Out of Scope (By Choice)** |
| **14** | Upgradeable contracts hide risk | 🔮 **PHASE 2** | Plain-English contract admin key & proxy permission explanations | **Built (Contract Explainer)** |

---

## ⚙️ 4. Technology Stack & Technical Innovation

- **Frontend**: React 19.2.7, TypeScript 6.0.2, Vite 8.1.4, TailwindCSS v4, Framer Motion.
- **AI & Classification Engine**: Google Gemini Flash (JSON Schema mode) + Local Rule-Based & Keyword Heuristic Parser.
- **Oracle & Cache Layer**: DefiLlama API + CoinGecko + Browser IndexedDB (`chainstory_db`) for **0ms repeat latency**.
- **Multi-Chain Indexer**: 5 EVM Networks (Ethereum Mainnet, Arbitrum One, Base L2, Optimism, Polygon PoS) with 429 exponential backoff throttler queue.
- **B2B Pre-Sign Simulation Library**: `@chainstory/core` SDK for pre-sign payload simulation.

---

## 🎬 5. 60-Second Hackathon Pitch Video Script

- **0:00 - 0:15 (The Problem)**: Show Etherscan raw hex signature `0x7ff36ab5`.  
  *"Blockchain data is built for machines, leaving everyday users blind to what happened, whether a transaction is taxable, or if a counterparty is dangerous."*
- **0:15 - 0:35 (The Solution & Story Engine)**: Paste `vitalik.eth` in ChainStory.  
  *"ChainStory solves the translation layer once. We index 5 EVM chains and translate raw hex into plain-English stories using Gemini AI with deterministic keyword fallback."*
- **0:35 - 0:50 (Wallet Intelligence & Risk)**: Point to Wallet Intelligence Card & Token Approvals Panel.  
  *"Our Wallet Intelligence card calculates wallet age, activity diversity, reputation, counterparty risk flags (Tornado Cash), and granted token approvals."*
- **0:50 - 0:60 (Draft Taxes & Call to Action)**: Show Tax Dashboard & PDF report preview.  
  *"ChainStory computes FIFO cost basis lots, generating downloadable CSVs and draft Form 8949 PDF reports. Try it live at our public URL!"*
