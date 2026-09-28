# 04 — Solana and ZK Compression

Status of facts: items marked `TODO(verify)` were not confirmed against current official docs. Light Protocol is evolving
(V1 concurrent trees → V2 batched trees; newer token programs). Treat SDK names and program IDs as data to verify, not memory.
Official sources: `zkcompression.com`, the Light Protocol repo, Photon repo (Helius), Solana docs.

## 1. Solana for engineers coming from EVM

| EVM habit | Solana reality | Consequence for ChainStory |
|-----------|---------------|----------------------------|
| One `to` + calldata per tx | A tx is a list of **instructions**, each calling a **program**, plus **inner instructions** (CPIs) | Interactions are per-instruction; protocol detection must look at inner instructions |
| ERC-20 `Transfer` logs | No logs for balance changes; use `preTokenBalances` / `postTokenBalances` | **Balance-diff-first** normalization (ADR-005) |
| Balances in contract storage | Tokens live in **token accounts** (ATAs) owned by the wallet | Aggregate by `(owner, mint)`, not by account address |
| Gas | Base fee + optional priority fee (+ optional Jito tip as a normal SOL transfer) | `fee.parts` |
| Storage is free once paid | Accounts need a **rent-exempt deposit** (refundable on close) | Rent ≠ fee (see tax mapping) |
| Approvals = allowances | SPL **delegate** + `delegated_amount` on token accounts; authorities (owner/close/mint/freeze) | Different audit (Phase 3) |
| Upgradeable proxy | Program **upgrade authority** on the ProgramData account | Different pre-scan (Phase 3) |
| Tx size not an issue | **1,232-byte** transaction limit | Matters for Guard input handling and the write path |

## 2. ZK Compression: what actually happens

- Compressed accounts keep their **data in the ledger** (emitted in transactions), and only a **commitment** (hash → leaf in a state Merkle tree)
  lives in on-chain state. This makes accounts much cheaper than rent-based accounts at scale.
- To spend/update a compressed account, the client fetches a **validity proof** (Groth16) from a Photon-compatible RPC (`getValidityProof`)
  proving that the input account hash is in a state tree (and that a new address doesn't exist yet when creating).
  **The proof is one constant-size ~128-byte object**, independent of tree depth; you add it to the instruction data.
- Spent inputs are **nullified** (nullifier queue); new outputs are appended to a state tree.
- Trees exist in **V1 (concurrent Merkle trees)** and **V2 (batched Merkle trees)**; the SDK supports both.
- An **indexer (Photon)** reads ledger events and exposes compressed state over RPC. It is *not* consensus-critical for safety (proofs are
  self-verifying) but is critical for **liveness and visibility**: if your indexer is behind or down, you cannot see recent compressed state
  or build transactions.
- Account types: **compressed tokens** (SPL / Token-2022 mints), **compressed SOL** (lamports in compressed accounts), **compressed PDAs**
  (arbitrary program-defined data).
- **Not the same as compressed NFTs (Metaplex Bubblegum).** cNFTs use SPL account compression and the DAS API. Out of scope until later.

### Why this is hard to read in a normal explorer
A compressed transfer appears as calls to the Light system / compressed-token / account-compression programs with opaque data and
Merkle tree accounts. Standard `preTokenBalances/postTokenBalances` show **nothing** for the compressed leg. The user's balance change is only
visible through the indexer.

## 3. Read path (the core of Phase 2)

Photon methods used (all confirmed present in the public method list):
`getCompressionSignaturesForOwner`, `getCompressionSignaturesForTokenOwner`, `getTransactionWithCompressionInfo`,
`getCompressedTokenAccountsByOwner`, `getCompressedAccountsByOwner`, `getCompressedBalanceByOwner`, `getIndexerSlot`, `getIndexerHealth`.

### Discovery and fetch

```
discover(owner):
  std  = getSignaturesForAddress(owner)                       // standard, paged (≤1000/page)
  cmp  = photon.getCompressionSignaturesForOwner(owner)       // compressed accounts owned by owner, paged
  cmpT = photon.getCompressionSignaturesForTokenOwner(owner)  // compressed token accounts, paged
  sigs = dedupe(std ∪ cmp ∪ cmpT) sorted by slot desc

for sig in sigs (bounded concurrency):
  if sig ∈ cmp ∪ cmpT:  raw = photon.getTransactionWithCompressionInfo(sig)   // tx + compressionInfo{opened_accounts, closed_accounts}
  else:                 raw = rpc.getTransaction(sig, { maxSupportedTransactionVersion: 0 })
  yield normalize(raw, owner)
```

`compressionInfo.closed_accounts` are **inputs spent**; `opened_accounts` are **outputs created**. Each entry may carry token data (mint, owner, amount)
or plain lamports/data.

### Normalization of compressed movements

Per mint (or native), for the subject wallet:

```
Δstd = post - pre        from meta.pre/postTokenBalances (or lamports)
Δcmp = Σ opened[owner==subject] − Σ closed[owner==subject]      from compressionInfo
```

| Δstd | Δcmp | Meaning | Movement roles / tags |
|------|------|---------|-----------------------|
| − x | + x | **Compress** | `compress` legs, tag `compression:compress`, category `compression`, **non-taxable** |
| + x | − x | **Decompress** | `decompress` legs, tag `compression:decompress`, non-taxable |
| 0 | ± x | Compressed transfer in/out | `state:'compressed'`, tag `compression:transfer` |
| ± x | 0 | Normal transfer | standard |
| other | other | Swap or mixed | classify by program registry |

Compressed PDAs (arbitrary program data) → generic story: "Created/updated/closed a compressed account owned by `<program>` (N bytes)".
Known programs can register a decoder; unknown programs get the generic story (I8).

### Estimated rent avoided (optional UI stat)
For each *opened compressed token account*, the equivalent standard token account would lock a rent-exempt deposit
(query `getMinimumBalanceForRentExemption(165)` live; don't hardcode). Display as **"≈ X SOL rent deposit avoided (estimate; deposits are refundable on close)"**.
Do not present it as a permanent cost saving.

### Indexer health
Compare `getIndexerSlot` to RPC `getSlot`. If lag > threshold (default 150 slots, tunable) show the lag banner; if Photon is unreachable or the
provider lacks it, render standard activity and a "compressed activity unavailable" notice. Compressed data near the tip is not final: don't cache it as final.

### Protocol churn policy
Compression program IDs, instruction discriminators, and tree versions change. Keep them in `chains/solana/registry/light.ts` as data with a version tag.
Unknown Light-family instructions → generic "compressed state change" story + `unknown_program`, never an error. Add a fixture per new version.

## 4. Standard Solana normalization (Phase 1)

Three tiers, in order:

1. **Balance-diff.** From `meta.preBalances/postBalances` (net of fee) and `pre/postTokenBalances`, compute per-`(owner, mint)` deltas for the subject.
   This alone yields correct amounts for *any* program, including unknown ones.
2. **Program registry.** Identify protocols by program IDs found in the message and inner instructions (System, Token, Token-2022, ATA, Compute Budget,
   Stake, Jupiter, Raydium, Orca, Meteora, Light-family). Registry entries: `{ programId, protocol, source, verifiedAt }`. Populate from official
   sources / explorer-verified, never from memory (I11).
3. **Instruction decoders** only where nuance matters (stake delegate vs. withdraw, add-liquidity vs. swap, SetAuthority, Approve).

Optional accelerator: a provider's "enhanced/parsed transactions" API behind the same adapter interface. It must never be required; results are validated
and, on disagreement with balance-diff, balance-diff wins for amounts.

Special cases: wSOL wrap/unwrap (SyncNative / CloseAccount on a native-mint account) → non-taxable `wrap`/`unwrap`; ATA creation → `rent` leg;
failed txs still pay fees.

## 5. Jito and MEV indicators (Phase 3)

| Signal | How | Claim allowed |
|--------|-----|---------------|
| Jito tip | A SOL transfer to one of Jito's tip accounts inside the tx (usually the last instruction). Fetch tip accounts from the block-engine `getTipAccounts` and cache; keep a pinned fallback list in `registry/jito.ts` (`TODO(verify)` values) | "Included a Jito tip of X SOL — likely sent through a Jito bundle." (indicator, not proof) |
| Priority fee | ComputeBudget `SetComputeUnitPrice` × units | Fee breakdown |
| Possible sandwich | **On demand only** (per tx, "Inspect MEV"): fetch the block, find txs in the same slot before/after the victim touching the **same pool accounts** in opposite directions with attacker profit > 0 | "Possible sandwich pattern" + evidence signatures. **Never** a loss percentage unless computed from pool math; show attacker-side profit as an upper bound |

Bulk feed never runs the sandwich heuristic (block fetches are heavy and false positives are costly).

## 6. Solana risk analogs (Phase 3)

| EVM feature | Solana equivalent | Data source |
|-------------|-------------------|-------------|
| Unlimited approval audit | Token accounts with `delegate` set and `delegatedAmount`; Token-2022 permanent delegate / transfer hook on mint | `getTokenAccountsByOwner` (jsonParsed), mint account |
| Upgradeable proxy / admin key | Program `upgrade_authority` (null = immutable) via ProgramData account | `getAccountInfo` on program + programdata |
| Owner can mint / freeze | Mint `mintAuthority` / `freezeAuthority` non-null | mint account |
| Known drainer / sanctioned lists | Same lists, Solana addresses | `TODO(source)` — needs a vetted data source |

## 7. Write path: `programs/story-attest` (Phase 5, optional, gated)

**Purpose (in priority order):**
1. Generate a **compressed-PDA** transaction path to test the generic decoder (compressed tokens/SOL can be exercised with TS scripts alone).
2. Opt-in **"Story Receipt"**: a compressed account per `(wallet, snapshotId)` holding `{ schemaVersion, tier, commitment = hash(canonical snapshot), issuedSlot }`.

**Hard constraints**
- Signing is required, which conflicts with I1. Therefore attest lives in `programs/` + `scripts/attest/` (CLI or separate entry), **never in the analysis bundle**.
- Commitments only; no PII; reputation is self-computed, so a receipt proves "this snapshot existed and this key attested it," not that it is *true*.
- Follow current `light-sdk` / `zkcompression.com` program examples; verify SDK API before coding. Do not hand-roll proof verification or tree sharding — use the
  SDK's state-tree selection helpers.
- Write-path failure modes (only here, not in the read path): stale proof / indexer lag → refetch proof and retry with backoff; tree write contention → retry against a
  different tree; tx size → packed accounts + address lookup table.

**Kill criteria:** if no consumer for receipts exists by end of Phase 4, drop Phase 5. The read path stands on its own.
