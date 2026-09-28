# 01 — Vision and Scope

## Problem

Blockchain history is unreadable to normal people: hex calldata, selectors, wei values, and (on Solana) multi-instruction
transactions with inner instructions and token-account balance changes. Existing explorers show *what bytes changed*,
not *what happened to me*. This causes three concrete pains:

1. **Comprehension:** "What did this transaction do?"
2. **Compliance:** "What do I owe?" (cost basis, short/long-term gains, income, deductible fees)
3. **Safety:** "Who am I interacting with, and what permissions have I granted?"

## Users

| User | Job to be done |
|------|----------------|
| Retail DeFi/NFT user | Understand history, produce a tax draft, find dangerous approvals |
| Analyst / researcher | Quickly read a wallet's behavior and reputation |
| Solana developer / ecosystem reviewer | See compressed state changes in human terms (currently opaque in explorers) |

## Product principles

1. **Client-side and read-only.** No backend, no wallet connection, no custody.
2. **Explain, don't just decode.** Every output is a sentence a non-technical person understands, backed by structured evidence.
3. **Numbers from code, words from models.** LLMs never produce amounts, assets, or accusations.
4. **Honest confidence.** Every story carries source and confidence; uncertainty is shown, not hidden.
5. **Degrade gracefully.** Unknown protocol → generic story. Missing indexer → clear message, not a crash.

## Scope

**In scope**
- EVM (5 chains, existing) and Solana mainnet (+ devnet for fixtures).
- Standard Solana accounts **and** ZK-compressed accounts (Light Protocol; compressed tokens, compressed SOL, compressed PDAs).
- Story feed, wallet reputation, counterparty screening, permission audit, pre-scan contract/program risk, FIFO tax draft.
- Solana MEV *indicators* (Jito tip detection; on-demand sandwich heuristic).
- Pre-sign simulation ("Guard") for Solana, read-only.

**Out of scope (for now)**
- Signing, sending, wallet connect, custody (except the isolated Phase 5 attest tooling, which is not part of the analysis app).
- Server-side indexing, accounts, cloud sync.
- Compressed NFTs via Metaplex Bubblegum (a different compression mechanism, see glossary) — later phase.
- Firedancer / validator-client tooling — not relevant to a wallet-narrative product.
- Non-US tax regimes. Tax output is a **draft**, not tax advice.
- Bridges/cross-chain own-wallet matching beyond simple heuristics (open question in roadmap).

## Success criteria

- Paste an EVM **or** Solana address in one search bar and get a correct story feed within a progressive-loading budget
  (first cards < 5 s on a typical wallet; full history streams in).
- Compressed-token compress / transfer / decompress on Solana renders as three correct stories and is **not** taxed as disposal.
- FIFO output for fixture wallets matches hand-computed spreadsheets to the last unit.
- Zero uncaught exceptions on unknown programs/selectors in a fuzz run over recorded fixtures.

## The two source notes: what I kept and what I changed

The original notes contain good ideas and several claims that would mislead an engineer or an AI agent. Corrections:

| Source claim | Assessment | Decision |
|--------------|-----------|----------|
| "Integrate into ChainStory, don't build a separate product." | **Agree.** Compressed-state explanation is a feature of a narrative engine, not a product. | ADR-001 |
| "Next.js 16 App Router" (roadmap note) vs. ChainStory = React 19 + Vite SPA | **Conflict.** A client-only tool gains nothing from SSR; switching frameworks would be pure cost. | Stay on Vite. ADR-002 |
| "Merkle proofs scale with tree depth and can breach the 1,232-byte limit." | **Inaccurate for ZK Compression.** The client attaches **one constant ~128-byte validity proof**; size pressure comes from the number of accounts referenced, mitigated with packed accounts and address lookup tables. (Depth-scaling proofs apply to Metaplex cNFT-style compression.) | Documented in `04` |
| "Concurrent Merkle trees + write-lock contention → shard state" | **Partly true, outdated framing.** V1 uses concurrent trees; V2 uses batched trees. Protocol evolves. Do not hand-roll sharding; use SDK tree-selection helpers. Only matters for the write path (Phase 5). | `04` §Write path |
| "Indexer desync → poll latest slot hash, retry, fall back to second indexer." | **Right instinct, wrong emphasis.** For ChainStory (read path) desync = missing recent txs. Solution: compare indexer slot to RPC slot (`getIndexerSlot` / `getIndexerHealth`) and show a lag banner. | `04` §Indexer health |
| "Show 'Warning: transaction was sandwiched with 1.8% slippage loss'." | **Unsafe.** Victim loss is not derivable from chain data alone without pool math; false accusations are harmful. | Heuristic, evidence-backed, "possible" wording. `06` |
| "Everything runs 100% client-side, no private data leaves your device." | **Overclaim.** Addresses and tx data are sent to RPC/indexer/price/LLM providers the user configures. | Corrected wording in `06` §Privacy |
| Solana bottlenecks list includes Firedancer multi-client tooling. | **Not relevant** to this product. | Dropped |
| "AI pre-execution agent that blocks malicious drainers." | **Reframe.** A read-only web tool cannot *block* anything; it can *simulate and warn*. | Phase 4 "Guard" |
| Pre-scan "upgradeable proxy / admin keys / selfdestruct" | EVM-only vocabulary. Solana analogs: program **upgrade authority**, token **mint/freeze authority**, SPL **delegates**. | Phase 3 |

## Assumption about "the two projects"

I read the second document as a **build roadmap for a ZK-compressed Solana app** (Anchor program + indexer + client proofs),
not as an existing codebase. If it *is* an existing codebase, its client code should be folded into `src/chains/solana/`
and its program into `programs/`; the plan otherwise still holds.
