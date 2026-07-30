# 🚀 ChainStory — Two-Phase Roadmap & Product Evolution

**ChainStory** is a focused Wallet Intelligence platform. It explains your wallet to you — its past, its taxes, its risks, and what it is exposed to next.

---

## 🎯 The Product Filter & Product Thesis

> **Filter Criterion**: A feature is **in-scope** if it makes a wallet's own history or exposure legible in plain English.  
> A feature is **out-of-scope** if it requires ChainStory to become a separate chain-wide analytics platform, governance tool, or professional security auditing service.

The distinction that holds the line:
- **In-Scope**: Explaining what external things do (or will do) to **your wallet**.
- **Out-of-Scope**: Analyzing external protocols, bridges, or contracts for their own sake.

---

## 📅 Phase 1 — Hackathon (v1: Retrospective Wallet Intelligence)

**Goal**: Deliver a focused, live, verified, and deployed wallet intelligence tool.

### Features & Capabilities (Shipped)
- **AI Plain-English Story Generator (`#10`)**: Converts raw transaction logs into readable 1-sentence narrative stories (Gemini JSON Schema mode + deterministic keyword fallback).
- **Draft Tax Accounting Engine (`#11`)**: Auto-categorizes transactions, queries historical prices via DefiLlama + CoinGecko + IndexedDB, calculates FIFO cost basis lots, and exports CSV + draft Form 8949 / Schedule D PDF reports.
- **On-Chain History Legibility (`#1`)**: Transforms unreadable block explorer hex inputs into a legible activity feed.
- **Wallet Intelligence Card (`#12`)**: Displays wallet age, activity frequency, protocol diversity, and a transparent heuristic reputation label (*Established Veteran*, *DeFi Explorer*, *Regular Active*, *Newly Created*).
- **Counterparty Risk Screening (`#4`)**: Cross-screens counterparty addresses against a curated database of known mixers (Tornado Cash), sanctioned entities, and exploit drainers with warning badges.
- **Token Approvals Transparency (`#2`)**: Surfacing past ERC-20 token approvals in plain English, highlighting unlimited allowances for user security awareness.

---

## 🔮 Phase 2 — Post-Hackathon (v2: Preventive Wallet Intelligence)

**Goal**: Extend ChainStory from **retrospective** (*what your wallet has done*) to **preventive** (*what your wallet is about to do*), protecting the same user and wallet without changing product focus.

```
       Phase 1 (v1)                     Phase 2 (v2)
  RETROSPECTIVE INTELLIGENCE       PREVENTIVE INTELLIGENCE
 ┌──────────────────────────┐    ┌──────────────────────────┐
 │ • Plain-English History  │    │ • Preventive Scam        │
 │ • Draft Form 8949 Tax    │ ──►│   Token Warnings (#3)    │
 │ • Reputation Summary     │    │ • Plain-English Contract │
 │ • Risk Flag Screening    │    │   Permission Risk (#14)  │
 │ • Granted Approvals (#2) │    └──────────────────────────┘
 └──────────────────────────┘
```

### 2A. Preventive Scam & Risky-Token Warnings (`#3`)
- **Concept**: Before a user interacts with an unverified token, ChainStory warns them in plain English: *"This token contract was deployed 2 days ago, liquidity is thin, and 3 flagged addresses have interacted with it."*
- **Thesis Fit**: Protects the user's wallet before an interaction occurs.
- **Data Requirements**: Token contract age, verification status, liquidity data, and token-level risk lists.
- **Strict Boundary**: Warns on what the user is about to touch — does not attempt to score every token on the blockchain.

### 2B. Plain-English Contract-Risk Explanations (`#14`)
- **Concept**: Explains in plain English what a contract can do to a wallet before approving: *"This contract is upgradeable: the owner can alter its logic after approval, including transferring funds."*
- **Thesis Fit**: Applies the core AI readability engine (`#10`) to contract permissions instead of transaction history.
- **Data Requirements**: Contract source / proxy bytecode analysis to detect admin keys, upgradeability, and dangerous functions.
- **Strict Boundary**: Explains permission risk to this wallet in plain English — does not perform formal smart contract security audits (`#13`).

---

## ⛔ Permanently Out of Scope (By Choice)

Declining these items maintains product sharpness and prevents scope creep:

1. **DeFi Protocol Financial Risk Scoring (`#5`)**: Requires protocol TVL, audit records, and liquidity analytics — belongs to a dedicated DeFi analytics platform.
2. **Impermanent Loss & Yield Farming LP Modeling (`#6`)**: Requires live liquidity pool state tracking.
3. **Cross-Chain Bridge Vulnerability Risk (`#7`)**: Requires real-time bridge security monitoring pipelines.
4. **DAO Voter Apathy & Whale Capture (`#8`, `#9`)**: Governance analytics targeting DAOs and voters, not personal wallet intelligence.
5. **Smart Contract Code Auditing (`#13`)**: Formal code vulnerability auditing — a specialized security discipline.

---

## 🎤 The Pitch Arc

> **Today (v1)**: *Retrospective Wallet Intelligence* — Understand what your wallet has done (history, draft taxes, reputation, risk exposure, granted approvals).  
> **Next (v2)**: *Preventive Wallet Intelligence* — Understand what your wallet is about to do (risky token warnings before buying, dangerous contract permission explanations before approving).  
> **Always**: Make your wallet legible in plain English.
