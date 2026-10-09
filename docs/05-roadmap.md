# 05 — Roadmap

Rules for this roadmap: every phase ends with something **runnable and testable**; every "Done when" is **checkable**.
Sizing is relative (S ≈ days, M ≈ 1–2 weeks, L ≈ 3+ weeks of focused work), not a date promise.
Update the status table in `docs/README.md` and the checkboxes here as work lands.

## Hackathon build (September 2026) — status

### Active Tripwire work — 2026-10-09

The current project focus is Tripwire. [Hardening plan](plans/tripwire-hardening.md)
supersedes the hackathon scope for new work; the legacy wallet/Solana phases below
remain historical context.

| Milestone | Status |
| :--- | :--- |
| Signed per-release execution gate, retryable source/recipient observations and event cursor recovery | Implemented locally; see hardening plan for validation and trust boundaries |
| Durable operator state, signed transaction journal and HOLD/delay recovery | Implemented locally; [operator runbook](plans/tripwire-operator.md); no live deployment |
| Ethereum/Sepolia finalized observations, receipt reorg recovery and durable quarantine | Implemented locally; ADR-016; no live deployment |
| CCTP v2 Standard USDC adapter, Base Sepolia → Ethereum Sepolia | Implemented locally; [escrow/runbook](plans/tripwire-cctp.md), ADR-017; synthetic fixtures, live pilot pending |
| Authenticated CCTP mint → immutable pending escrow release | Implemented locally; ADR-018; self-owned escrow, exact net mint, atomic rollback and authenticated operator policy; external review/deployment pending |
| Continuous refresh of justified route protection | Implemented locally; ADR-019; chain-bound expiry/clock/oracle reconciliation, renewed pending assessments and existing durable outbox; live operation pending |
| Route-scoped guardian reporters, conservative rolling cap and per-request DELAY | Implemented locally; ADR-020; [policy/rollout](plans/tripwire-route-policy.md); fresh policy-v2 deployment and external review pending |
| Threshold attestation: k-of-n `TripwireQuorum` as the guardian/vault oracle | Implemented locally; ADR-021; policy v3; [build map](plans/tripwire-settlement-firewall.md); networked members and deployment pending |
| Independent multi-RPC verification of source proofs | Implemented locally; ADR-022; quorum agreement, dissent holds, finalized conflict quarantines; light-client finality pending |
| Proof-first settlement verdict and tighten-only route policy | Implemented locally; ADR-023; named proof/safety checks, per-route size limit and hold line |
| Audit remediation, policy v4: time-locked oracle rotation and kill switch, no cap raise under protection, 72-hour oracle span, cumulative DELAY | Implemented 2026-10-02; ADR-024; audit PoCs inverted in `auditRegression.evm.test.ts`. Integration review of all contributors' branches 2026-10-04: no test or exported function lost; the kill switch now also cancels a pending rotation (ADR-024 addendum); 63/63 mutants caught, 749 tests |
| REJECT as a 7-day hold that fresh evidence can reopen (CctpEscrow funds never stranded) | Implemented locally; ADR-025; contract and operator |
| Separate key roles (owner Safe, oracle, two relayers), separate nonce lanes, fee-bumped replacement | Implemented locally; ADR-026; deploy and operator refuse one key |
| Rolling baseline, safe-head release requests, exact one-sided backing, RPC failover, backoff | Implemented locally; ADR-027 |
| Live deployment of the release-gated vault | Deployed to Sepolia 2026-10-03, policy v4: guardian `0xF58C0711Fed0F425383E5D07345880488889fE0F`, sources verified, ownership accepted by Safe `0x65DC895a989a8Ac3ef4Df7Eb1B968732c1fc3D0C`; live demo ran NONE → THROTTLE → DELAY → FREEZE. Deployment record: `scripts/tripwire/testnet/deployment.sepolia.json` |
| Independent quorum members (k-of-n signing on separate machines) | Not started: the contract enforces k-of-n, but the operator signs with one oracle key and the local quorum runs in one process |
| CCTP pilot observer and unsigned deployment package | Implemented locally; [pilot runbook](plans/tripwire-pilot.md); finalized evidence/state reporting, restart-safe claims and separate local role wallets; public deployment/transfer pending |
| Scorer input safety and outage recovery | Implemented locally; unavailable screening, invalid route statistics/USD/history/clock/config cannot clear; one screening snapshot; exact mismatch evidence remains blocking; [contract](plans/tripwire-hardening.md#scorer-input-safety--2026-10-05) |
| Product v1 policy, recovery and partner discovery | [Specification and P0 backlog](plans/tripwire-product.md) recorded; [interview/pilot kit](plans/tripwire-partners.md) prepared; shadow-policy separation, external review and customer pilot pending |
| Customer execution policy and funded destination returns | Implemented locally in `CctpPaymentEscrow`; [contract/runbook](plans/tripwire-payment-policy.md), ADR-028; new review format, customer/source/recovery bindings and exact accounting; public deployment and external review pending |
| Customer payment RPC operator, manifest v3 and return reconciliation | Implemented locally; [runbook](plans/tripwire-payment-operator.md), ADR-029; checked policy snapshots, exact receipt/operation proofs, format-3 signing, persistent returned outcomes and same-byte crash recovery; 812 tests; real public receipts/pilot pending |
| Exact product runtime acceptance and keyless deployment readiness | Implemented; [preflight/runbook](plans/tripwire-testnet-readiness.md), ADR-030; 833 tests; live read-only snapshot and fresh unsigned v3 package prepared; three gas accounts/source USDC empty, deployment/transfer/review pending |
| Receipt-backed initial product deployment acceptance | Implemented; [acceptance/runbook](plans/tripwire-deployment-acceptance.md), ADR-031; exact initcode/configuration receipts, finalized runtime/policy/accounting and complete sole-grant history; 889 tests; live keyless check is pending with four missing transactions |
| First Standard payment unsigned preparation | Implemented; [runbook](plans/tripwire-first-payment.md), ADR-032; live deployment/policy checks, Standard minimum fee, exact allowance/reset, reserved burn nonce and one simulated unsigned step; 950 tests; actual run blocked by four missing deployment transactions, no burn sent |
| Customer read-only operations viewer | Implemented at `/tripwire/operations`; [runbook](plans/tripwire-operations.md), ADR-033; public funding/customer observer import, holds/returns/receipt anchors, search/filter and stale/error states; 996 tests; no live service or payment authorization |
| Listed customer credit lifecycle receipts and timing | Implemented locally; [operations runbook](plans/tripwire-operations.md), ADR-034; canonical burn/mint times and bounded payout/return/request receipt history, exact block-time durations and explicit missing-history states; 1,056 tests; no public payment or complete treasury discovery |
| Bounded automatic customer operation discovery | Implemented in the keyless one-shot observer; [runbook](plans/tripwire-operations.md), ADR-035; finalized range coverage, automatic source/mint locators, full existing receipt audit and separate unmatched/conflict hints; 1,112 tests at ADR-035; persistent discovery added below, live service pending |
| Durable customer operation discovery | Implemented locally in the keyless observer; [runbook](plans/tripwire-operations.md#persistent-discovery-and-restart-recovery-adr-036), ADR-036; atomic hint/cursor storage, canonical restart rechecks, bounded catch-up/backlog and fresh receipt audit; 1,167 tests, build/typechecks and lint pass; watch added below; expanded retention and live pilot pending |
| Continuous keyless customer observer | Implemented locally; [runbook](plans/tripwire-operations.md#continuous-keyless-observer-adr-037), ADR-037; sequential durable discovery, bounded catch-up, outage backoff, terminal stops, abort/restart and atomic public snapshots; 1,229 tests, build/typechecks and lint pass; public deployment and supervision/alerts pending; local folder refresh added below |
| Local browser public-folder refresh | Implemented locally; [runbook](plans/tripwire-operations.md#automatic-local-report-folder-updates-adr-038), ADR-038; sequential read-only updates, no older-file fallback, scope/clock/bounds/cancellation guards; 1,257 tests, build/typechecks and lint pass; native folder selection/refresh end-to-end unverified because its dialog is inaccessible to automation; hosted service pending |
| Bounded public observer report archival | Implemented locally; [runbook](plans/tripwire-operations.md#bounded-archival-of-public-reports-adr-039), ADR-039; optional keep count, reversible flushed archival, 100-file batches, same-inode crash recovery and unchanged journal; 1,294 tests, build/typechecks and lint pass; disk usage, discovery retention, supervision and public deployment remain separate |
| Observer startup/exit classification (H2a) | Implemented locally; [exit contract](plans/tripwire-operations.md#observer-process-exit-contract-adr-040), ADR-040; fixed redacted diagnostics, typed startup RPC retry eligibility, terminal deployment/journal/quarantine and publication failures, cleanup/restart checks; 1,331 tests / 66 files at H2a; running classification added below |
| Observer running failure classification (H2b1) | Implemented locally; [running contract](plans/tripwire-operations.md#observer-running-failure-contract-adr-041), ADR-041; terminal proof/quarantine/discovery journal faults, exact running reasons, unknown/global evidence stops, validated RPC/lag retry and per-payment HOLD; 1,363 tests / 67 files, build/typechecks and lint pass; supervisor/crash drills/local incidents are H2b2 in [current checkpoint](plans/tripwire-progress.md) |
| Bounded foreground observer supervision and local incidents (H2b2) | Implemented and tested locally; [runbook](plans/tripwire-operations.md#bounded-observer-supervision-and-local-incidents-adr-042), ADR-042; fixed Node/tsx child, finite RPC/explicit-crash restart policy, same-journal crash/stop recovery, separate supervisor lease, redacted process/report condition records; 1,421 tests / 69 files, build/typechecks and lint pass; team service installation, host-crash/process-tree acceptance and live pilot remain open |
| Mandatory decision matrix and read-only behavioral model (H4a) | Implemented locally; [matrix/runbook](plans/tripwire-decision-matrix.md), ADR-043; current mandatory gates/owners/negative fixtures, pure scoped three-signal projection with null unavailable scores and no execution fields; 1,460 tests / 70 files, 39 added, build/typechecks and lint pass; operator/scorer/contracts unchanged, shadow-only enforcement disabled; H4b integration implemented below, H4c1 design recorded below; execution separation remains open |
| Optional behavioral advisory reports and viewer (H4b) | Implemented locally; [report/display contract](plans/tripwire-operations.md#behavioral-advisory-reports-and-viewer-adr-044), ADR-044; old reports compatible, strict scope/provenance/check-time binding, original capture preserved, explicit keyless assessment-not-produced, stale/future suppression and full snapshot replacement; 1,496 tests / 72 files, 36 added, build/typechecks and lint pass; synthetic browser smoke at desktop/390px, no live scoring or execution separation; H4c1 design recorded below, next pure H4c2 in [checkpoint](plans/tripwire-progress.md) |
| Customer advisory/screening policy design (H4c1) | Design recorded only; [proposed policy](plans/tripwire-behavioral-policy.md), ADR-045; exact field/decision/version/consent/expiry/rotation/replay matrices, separate issuer trust and guardian denial powers, future acceptance vectors and H4c2 read-only verifier gate; existing 1,496 tests / 72 files, build/typechecks and lint pass; no execution/configuration/signature/contract changes or live evidence |
| One codebase: payment escrow on guardian policy v4 | Integrated 2026-10-09; ADR-046; payment ADRs renumbered 028–045; payment REJECT stays final (customer return is the exit); operator keeps v4 semantics; live v4 Sepolia vault still accepted; observer stderr clean on Node 22. Totals in the integration row below |
| Pure screening evidence verifier (H4c2) | Implemented 2026-10-09; [checkpoint](plans/tripwire-progress.md), ADR-045; S01–S16 in 29 tests with hand-built digests; not wired into review/operator/contracts (H4c3 next) |
| Report-folder follow in a real browser (H1) | Automated Chromium run with a real directory handle, 12/12 synthetic checks (`scripts/smoke/operationsFolder.mjs`); native dialog and permission revocation still need a human |
| Audit package (H5) | Prepared: [tripwire-audit-package.md](plans/tripwire-audit-package.md); vendor, pinned commit and independent audit open |
| Integration verification, 2026-10-09 | Clean clone: npm ci, lint, typecheck, build and artifact drift clean; **1,668 tests / 80 files** pass (twice); **80 / 80 mutants caught**; both local demos pass; every route passes in real Chromium at 1280 and 390 px (20/20) after fixing two phone overflows |

Tripwire and Check before you sign, planned in [plans/tripwire-hackathon.md](plans/tripwire-hackathon.md) (each stage's result is recorded there).

| Stage | What | Status |
| :--- | :--- | :--- |
| 0 | Unblock: build, typecheck, tests green | ✅ |
| 1 | Graduated guardian: THROTTLE / DELAY / FREEZE, escalate-only; 14/14 mutants caught | ✅ |
| 2 | Scorer reuses Retold's contract risk; explorer transport for Node | ✅ |
| 3 | Watcher → attestor → guardian loop, locally, tier asserted per step | ✅ |
| 4 | Sepolia: deployed, source verified, live demo NONE → THROTTLE → DELAY → FREEZE | ✅ |
| 5 | Check before you sign at `/check`; nothing reachable from it can sign | ✅ |
| 6 | README scope table, this status, ADR-013, video script; Colosseum answers checked against the code ([submission_pack/COLOSSEUM_FORM.md](submission_pack/COLOSSEUM_FORM.md)), submission links point at the v4 guardian | ✅ (video to record) |
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
