# 🎬 ChainStory — Master Pitch Deck (10 Slides)

This presentation is designed for judging panels in both **Hackathon Tracks** and **Accelerator Demo Days**.

---

### Slide 1: Title & Vision
- **Header**: ⛓️ **ChainStory**
- **Tagline**: Wallet Intelligence — Understand Any Wallet's Story, Draft Taxes, and Risk in Plain English.
- **Presenter**: Founder & Core Development Lead
- **Key Visual**: Glassmorphic preview card showing raw hex converting into a plain-English story.

---

### Slide 2: The Core Problem
- **Header**: Blockchain Data is Built for Machines, Not Humans.
- **Point 1**: 420M+ wallet holders are blind to what their transactions mean.
- **Point 2**: Tax reporting is a nightmare without historical prices or category classification.
- **Point 3**: Counterparty risk and dangerous approvals cause millions in preventable wallet drains.

---

### Slide 3: The Key Insight
- **Header**: Solve the Translation Layer Once $\rightarrow$ Unlock 3 Major Products.
- **Core Thesis**: Usability, tax accounting, and risk exposure stem from the exact same root problem.
- **Solution Engine**: Translate raw hex into a categorized, priced, plain-English event once — powering **Readability**, **Taxes**, and **Risk** in one unified pipeline.

---

### Slide 4: Shipped Product Capabilities (v1 Live)
- **Header**: 5 EVM Networks, AI Story Narratives, Tax Engine & Risk Screener.
- **Feature 1**: AI Story Feed (Gemini JSON Schema mode + keyword fallback).
- **Feature 2**: Wallet Intelligence Card (Age, Activity Diversity, Reputation Label).
- **Feature 3**: Counterparty Risk Screener (Tornado Cash & Sanctions flag).
- **Feature 4**: Draft Form 8949 / Schedule D Tax Engine + CSV & PDF Exports.

---

### Slide 5: Product Scoping & The 14-Problem Scorecard
- **Header**: One Focused Product, Not a Shallow Multi-Tool.
- **Scorecard**:
  - **3 Solved**: On-chain readability (`#10`), tax reporting (`#11`), readable wallet history (`#1`).
  - **3 Added**: Wallet reputation (`#12`), counterparty risk (`#4`), token approvals (`#2`).
  - **2 Roadmap**: Preventive scam warnings (`#3`), contract permission risk (`#14`).
  - **6 Out of Scope**: DeFi/bridge/DAO/audit analytics deliberately declined to preserve sharp product focus.

---

### Slide 6: High-Performance Tech Stack
- **Header**: Multi-Chain Ingestion + Hybrid AI + Privacy-First Architecture.
- **Ingestion**: 5 EVM Networks (Ethereum, Arbitrum, Base, OP, Polygon) with 429 exponential backoff throttler.
- **Pricing**: DefiLlama historical pricing API + CoinGecko + Browser IndexedDB (**0ms repeat latency**).
- **Security**: Local FIFO calculations and client-side execution.

---

### Slide 7: Verification & Test Reliability
- **Header**: Proven Against Public Wallets with Zero Build Errors.
- **Proof**: Automated end-to-end assertions verifying story counts, disposal cost basis, and CSV output against `vitalik.eth` (`0xd8DA6BF26964aF9Ded7ede3308C4157ed3714123`).
- **Build Quality**: `npm run build` compiled cleanly in 519ms with zero errors.

---

### Slide 8: Business Model & Monetization Strategy
- **Header**: B2C Freemium SaaS + B2B Pre-Sign Simulation API (`@chainstory/core`).
- **B2C ($12/mo)**: Unlimited multi-chain export, PDF tax reports, Watchlist alerts.
- **B2B API ($0.002/call)**: Integration into Web3 browser wallets for pre-sign simulation & risk warnings before signature.

---

### Slide 9: Product Evolution (v1 Retrospective $\rightarrow$ v2 Preventive)
- **Header**: From What Happened to What Happens Next.
- **v1 Today (Retrospective)**: History, draft taxes, reputation summary, risk screening, granted approvals.
- **v2 Next (Preventive)**: Risky token warnings before buying (`#3`), plain-English contract permission explanations before approving (`#14`).

---

### Slide 10: Call to Action & Live Demo
- **Header**: Experience ChainStory Live.
- **Live App URL**: [http://localhost:5173/](http://localhost:5173/)
- **GitHub Repository**: [https://github.com/shokkanuly/Chainstory](https://github.com/shokkanuly/Chainstory)
- **Closing Tagline**: *"Wallet Intelligence — understand any wallet's story, draft taxes, and risk in plain English."*
