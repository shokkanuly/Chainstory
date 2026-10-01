# 05 — Roadmap

Rules for this roadmap: every phase ends with something **runnable and testable**; every "Done when" is **checkable**.
Sizing is relative (S ≈ days, M ≈ 1–2 weeks, L ≈ 3+ weeks of focused work), not a date promise.
Update the status table in `docs/README.md` and the checkboxes here as work lands.

## Hackathon build (September 2026) — status

### Active Tripwire work — 2026-09-30

The current project focus is Tripwire. [Hardening plan](plans/tripwire-hardening.md)
supersedes the hackathon scope for new work; the legacy wallet/Solana phases below
remain historical context.

| Milestone | Status |
| :--- | :--- |
| Signed per-release execution gate, retryable source/recipient observations and event cursor recovery | Implemented locally; see hardening plan for validation and trust boundaries |
| Durable operator state, signed transaction journal and HOLD/delay recovery | Implemented locally; [operator runbook](plans/tripwire-operator.md); no live deployment |
| Independent bridge adapter and finality/reorg handling | Next; not yet implemented |
| Live deployment of the release-gated vault | Not deployed; old Sepolia vault is incompatible with current demo scripts |

Tripwire and Check before you sign, planned in [plans/tripwire-hackathon.md](plans/tripwire-hackathon.md) (each stage's result is recorded there).

| Stage | What | Status |
| :--- | :--- | :--- |
| 0 | Unblock: build, typecheck, tests green | ✅ |
| 1 | Graduated guardian: THROTTLE / DELAY / FREEZE, escalate-only; 14/14 mutants caught | ✅ |
| 2 | Scorer reuses Retold's contract risk; explorer transport for Node | ✅ |
| 3 | Watcher → attestor → guardian loop, locally, tier asserted per step | ✅ |
| 4 | Sepolia: deployed, source verified, live demo NONE → THROTTLE → DELAY → FREEZE | ✅ |
| 5 | Check before you sign at `/check`; nothing reachable from it can sign | ✅ |
| 6 | README scope table, this status, ADR-013, video script | ✅ (video to record) |
| 7 | Motion and readability pass: live silk hero, decode motion across site and platform ([design-motion.md](design-motion.md)) | ✅ |

- [x] stage 0  - [x] stage 1  - [x] stage 2  - [x] stage 3  - [x] stage 4  - [x] stage 5  - [x] stage 6 docs  - [ ] video recorded  - [x] stage 7 motion

Launch material: posters for X, Instagram and Threads (`node docs/social/posters.mjs` renders them) and the post copy, in [social/launch-posts.md](social/launch-posts.md).

---

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 (gated)
 seams      Solana      ZK read     Jito/risk    Guard        attest
 (M)        (L)         (L)         (M)          (M)          (M, optional)
```

---

## Phase 0 — Foundation: chain-agnostic seams (M)

**Goal:** EVM behavior unchanged, but now flowing through `domain/` types and a `ChainAdapter`. Safety net exists before any Solana code.

**Steps**
1. **Characterize first:** record raw responses + current outputs (stories, tax CSV) for ≥3 wallets and ≥30 diverse txs across the 5 chains into `src/testing/fixtures` and `golden/`.
2. Add `src/domain/` types and zod schemas from `03-domain-model.md`.
3. Add `src/chains/types.ts`, `registry.ts`, `http.ts`; move `evmIndexer.ts`, `abiDecoder.ts`, approvals/pre-scan into `src/chains/evm/` behind the adapter (moves and wrappers, no logic change).
4. Make `tax/`, `classify/`, `risk/`, `pricing/` consume `NormalizedTx` (thin mapping from existing shapes where needed).
5. Add boundary lint (ADR-003) and CI: typecheck, lint, test, golden.

**Depends on:** nothing.
**Done when:** `test:golden` shows **zero diff** vs. the pre-refactor snapshot; lint fails if `tax` imports from `chains`; CI green.

- [x] characterization fixtures  - [x] domain types  - [x] adapter + EVM move  - [x] consumers migrated  - [x] lint + CI

---

## Phase 1 — Solana thin slice, standard accounts (L)

**Goal:** Paste a Solana address → correct story feed and tax draft for non-compressed activity.

**Steps**
1. Address detection + routing in the search bar (`0x…` → EVM, base58 → Solana). `.sol` names later.
2. `chains/solana/`: `rpc.ts` (provider abstraction, throttle), `signatures.ts` (paging, cap 500 initial), `normalize/balanceDiff.ts`.
3. Program registry (System, Token, Token-2022, ATA, ComputeBudget, Stake, Jupiter, Raydium, Orca; each entry with source + verifiedAt).
4. Rules for: SOL/SPL transfers, swaps (balance-diff + Jupiter/Raydium/Orca IDs), stake/unstake, ATA creation (rent), wrap/unwrap.
5. Pricing: DefiLlama Solana coin IDs first, CoinGecko fallback; same cache.
6. Tax: fees (base + priority), rent as non-taxable deposit, FIFO over SPL assets.
7. UI: chain badge, Solana explorer links, "unparsed" drawer.

**Depends on:** Phase 0.
**Done when:**
- 3 recorded wallets (simple transfers / active swapper / staker) match golden stories.
- FIFO output for the swapper wallet equals a hand-computed spreadsheet.
- A tx calling an unregistered program yields a generic story, `confidence: low`, no exception (fuzz test over all fixtures passes).

- [x] detection+routing  - [x] rpc+paging  - [x] balance-diff  - [x] registry+rules  - [x] pricing  - [x] tax  - [x] UI

---

## Phase 2 — ZK Compression read support (L)

**Goal:** Compressed tokens/SOL/PDAs activity is explained correctly and taxed correctly.

**Steps**
1. `chains/solana/photon.ts`: typed client for the methods in `04` §3; zod-validated; provider-agnostic endpoint config; Settings field for Photon endpoint.
2. Discovery merge (standard ∪ compressed signatures) and `getTransactionWithCompressionInfo` normalization with the Δstd/Δcmp table.
3. `registry/light.ts` (versioned program/instruction data) + generic compressed-PDA story.
4. **Fixture generator:** `scripts/fixtures/zk/` creates on devnet/local validator: compress SOL, compress token, compressed transfer, decompress, close; records raw txs to fixtures.
5. Tax: compress/decompress → `nontaxable_move`; same asset key across states.
6. UI: compressed badge, indexer-lag banner, "provider lacks Photon" notice, optional "rent deposit avoided (estimate)" stat.

**Depends on:** Phase 1 (balance-diff + Solana pipeline), Photon-capable provider key.
**Done when:**
- Fixture wallet renders exactly: *Compressed X token*, *Sent X compressed token*, *Decompressed X token* (golden).
- Per-mint net across states equals expected (property test: compress then decompress ⇒ Δ = 0 and no tax events besides fee).
- Killing the Photon endpoint yields standard history + notice, not an error.
- Simulated Photon lag (mock `getIndexerSlot`) shows the banner.

- [x] photon client  - [x] discovery+normalize  - [x] light registry  - [x] fixture generator  - [x] tax rules  - [x] UI states

---

## Phase 3 — Solana intelligence (M)

**Goal:** Solana parity with the EVM safety features, plus Solana-specific signals.

**Steps**
1. Delegate audit (SPL delegates, Token-2022 permanent delegate/transfer hook) → `PermissionFinding`.
2. Program/mint pre-scan: upgrade authority, mint authority, freeze authority.
3. Jito tip detection (`jito.ts`, tip accounts fetched + pinned fallback); fee breakdown in stories.
4. On-demand "Inspect MEV" sandwich heuristic with evidence and wording policy (`06`).
5. Reputation across chains (age, frequency, protocol diversity, counterparty hygiene) computed from `NormalizedTx`; retrain ONNX with Solana samples (`ml/`).
6. Multi-wallet portfolio + own-wallet transfer detection (user-tagged wallets).

**Depends on:** Phase 1 (2 for compressed-aware audit).
**Done when:** fixtures for a wallet with an unlimited-style delegate, a token with active freeze authority, a program with non-null upgrade authority, a tipped tx, and a
known sandwiched tx each produce the expected finding/wording; benign fixtures produce **no** accusatory warnings (measured false-positive count = 0 on the benign set).

- [x] delegate audit  - [x] pre-scan  - [x] Jito  - [x] MEV inspect  - [x] cross-chain reputation  - [x] portfolio

---

## Phase 4 — Guard: pre-sign simulation (M)

**Goal:** Paste a serialized unsigned Solana transaction → plain-English preview of what it will do to the subject wallet, with risk flags. Read-only; **advisory, not blocking**.

**Steps**
1. Input: base64 tx (and deep-link import). Deserialize (legacy + v0 with address lookup tables).
2. `adapter.simulate`: `simulateTransaction` with signature verification off and blockhash replaced; request post-state of subject's accounts.
3. Diff pre/post → `NormalizedTx`-shaped preview → same story pipeline.
4. Risk flags: unknown program, delegate/approve, SetAuthority, upgrade-authority change, token account close to unfamiliar address, unregistered mint.
5. Clear limitation copy: simulation ≠ guarantee (state can change before landing; program logic can behave differently on-chain).

**Depends on:** Phase 3 (risk rules), Phase 1 (pipeline).
**Done when:** a set of ≥10 recorded drainer-pattern txs are flagged; ≥30 benign txs (swaps, transfers, stakes) produce correct previews with false-positive flags < 5%
(target to be tuned, measured in CI); no code path signs or sends.

- [x] deserialize  - [x] simulate  - [x] preview story  - [x] risk flags  - [x] limitation UX

---

## Phase 5 — `story-attest` compressed receipts (M, experimental, gated)

**Gate to start:** Phases 1–4 shipped, and a named consumer of receipts exists (someone who would read them).
**Goal:** Opt-in, hash-only "Story Receipts" as compressed accounts; also exercises the generic compressed-PDA decoder on real program output.

**Steps:** Anchor + Light SDK program (`programs/story-attest`); local tests with `light-program-test`; devnet deploy; `scripts/attest/` CLI (signing lives here, not in the web app);
read-back through the existing Solana adapter; UI shows "Receipt found" on wallets that have one.

**Done when:** create → read-back via adapter → verify commitment matches recomputed snapshot; indexer-lag and stale-proof retry paths tested; security review checklist in `06` passed.
**Kill criteria:** no consumer by end of Phase 4 → drop.

- [x] program  - [x] local tests  - [x] devnet  - [x] CLI  - [x] read-back + UI

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Light Protocol / Photon changes (V2 trees, new token programs) | Decoder breaks | Versioned registry, generic fallback (I8), fixture per version |
| Browser-only + rate-limited providers | Slow/partial loads on big wallets | Caps, progressive rendering, backoff, user keys |
| Tax mistakes | Users file wrongly | Draft labeling, deterministic engine, golden tests, "needs review" bucket, professional-review of policies |
| False MEV/drainer accusations | Reputational/legal | Evidence lists, "possible" wording, on-demand only |
| LLM hallucination / prompt injection via token names | Wrong or manipulated stories | I5, JSON-schema output, data-not-instructions prompt, no tools for the model |
| Scope creep (Firedancer, agents, cNFTs) | Nothing ships | Out-of-scope list in `01`; ADR required to add |
| Key exposure in browser | Cost/abuse | User-supplied keys, restricted demo keys only |

## Open questions (need a human decision)

1. Which Photon-capable provider(s) do we officially support, and what is the free-tier story for users?
2. Tax treatment: staking receipt tokens, non-refundable Solana account-creation costs, bridging. Needs tax-professional review.
3. Own-wallet detection: user-tagged only, or heuristic (with false-positive risk)?
4. Hosting/demo key policy for a public deployment.
5. Do we need Solana names (`.sol`/SNS) in Phase 1 or later?
