# Plan — Tripwire + "Check before you sign" (hackathon scope)

Status: **approved 2026-09-28 — Stage 0 done; Stage 1 next.** Written 2026-09-28 after indexing the repo
(codebase-memory-mcp, project `chainstory`) and reading AGENTS.md, docs/02, 05, 07.

## 1. Why

- **Problem.** Bridge drains finish in one transaction; the only human-free response
  today is a binary pause multisig. Separately, wallet users sign calldata they
  cannot read.
- **Users.** (a) A bridge operator who wants outflow throttled/delayed/frozen
  automatically, proportionally to risk. (b) A wallet user who pastes a pending
  transaction and wants a plain-English, risk-rated explanation. (c) Judges, who must
  see attack → detection → attestation → on-chain state change live.
- **Constraints.** Hackathon window; honest 🔨-vs-🗺️ scope; AGENTS.md invariants
  I1–I12; one product (ADR-001).
- **Success.** On a public testnet a judge can inspect: a scripted attack is scored,
  a signed attestation lands, and the guardian's tier visibly changes. Separately,
  a benign transfer reads green and an unlimited approval to a fresh unverified
  contract reads red with reasons.

## 2. What exists (from the index)

| Need | Already in the repo | Note |
| :--- | :--- | :--- |
| Calldata decode + pre-sign risk | `services/b2bSimulation.ts` `simulateTransactionPayload`, `services/abiDecoder.ts` `decodeAbiData` | Behind the Workspace "Test B2B Pre-Sign API" button |
| Contract risk: verified, age, proxy, admin powers | `services/contractIntel.ts` `fetchContractIntel`, `services/contractRiskExplainer.ts` `explainContractPermissionRisk` | |
| Flagged counterparties | `services/preventiveScamScanner.ts` `KNOWN_MALICIOUS` | ~13 addresses |
| Tripwire scorer (pure) | `tripwire/riskScorer.ts` `scoreTransfer` | No network; good |
| EIP-712 signing, guardian in an EVM | `tripwire/onChain.ts`, `tripwire/guardianVM.ts` | Used by tests and the replay |
| Solana pre-sign guard | `chains/solana/guard.ts` (roadmap Phase 4, marked done) | EVM "check before you sign" should mirror its shape |

Findings that change the plan:

1. **`src/chains/*` and `src/domain/*` are not wired in** — zero callers in the graph.
   Build on `services/` for now; migrating to the adapter seam is roadmap Phase 0.
2. **`contractIntel` is browser-only**: it calls `apiClient.explorerRequest`, which
   reads `window.location`. A Node watcher cannot import it unchanged.
3. **Tripwire does not use Retold's risk logic today.** The new scope asks it to.
4. **Uncommitted tier change in `TripwireGuardian.sol` has three bugs:**
   DELAY caps at 75% while THROTTLE caps at 50% (escalation loosens the limit);
   DELAY applies no delay; a lower-score attestation downgrades an active tier.
5. **Gemini models in `server/geminiHandler.ts` and `ml/collect_training_data.py` are
   retired** (`gemini-2.0-flash`, `gemini-1.5-flash`). AI descriptions cannot work
   until updated. Verified working for the provided key: `gemini-3.7-flash`,
   `gemini-flash-lite-latest`.
6. **Docs vs code**: AGENTS/ADR-006 say "no backend, user-supplied keys", but
   `api/` + `server/` hold keys server-side (a deliberate security fix). Needs an ADR
   either way; flagged, not changed here.

## 3. Design

**Where Tripwire's write path lives — options considered**

- *A. Keep everything in the browser replay.* Zero invariant risk, but fails the
  core scope item: a public-testnet contract judges can inspect.
- *B. Operator-run Node scripts + testnet contracts (chosen).* `scripts/tripwire/`
  holds the watcher and the single-signer attestor; contracts deploy with viem.
  The analysis app stays read-only (I1 holds for the app). Cost: a new
  operator-side component → needs **ADR-012**.
- *C. Serverless attestor (Vercel cron).* Adds hosted infra and a hosted signing key
  — worse on I2 and key safety than B, for no demo benefit.

**Reuse without breaking layers**

- The scorer stays **pure**. A new optional input `targetContract?: ContractRiskSummary`
  (verified, ageDays, isProxy, admin powers) adds a `contract_risk` signal. The
  *caller* fetches it. `tripwire/` gains no network code.
- The watcher fetches contract risk by giving `apiClient` a **pluggable transport**:
  default = `/api` over HTTP (browser, unchanged); in Node =
  `server/explorerHandler.handleExplorer` called directly with `process.env`.
  `contractIntel.ts` itself does not change.
- Thresholds live in **one** shared constant set used by the scorer, the attestor and
  the contract tests; a cross-layer test pins scorer verdict ⇔ contract tier, the
  same pattern that caught the earlier 0.75/75 boundary bug.

**Tier semantics (fixes finding 4)**

| Tier | Score | Effect | Expires |
| :--- | :--- | :--- | :--- |
| THROTTLE | ≥ 65 | Window cap → 50% | 24h |
| DELAY | ≥ 85 | Outflows above a small threshold are queued; released after 30 min unless the owner cancels | 24h |
| FREEZE | ≥ 95 | All outflows revert | 24h |

Tiers only **escalate** while active; the owner can resume. For the demo the delay
window is configurable down to seconds. DELAY is a real queue, not a smaller cap.

**"Check before you sign"** — a new page `/check`: paste calldata + target contract
(or a tx hash). Pipeline: `decodeAbiData` → `simulateTransactionPayload` →
`explainContractPermissionRisk` → counterparty check → badge (green/yellow/red with
reasons) → optional Gemini phrasing of the *structured* result (I5: numbers from code,
words from the model). Advisory only; nothing signs (I1).

## 4. Roadmap

**Stage 0 — Unblock (S)** · ✅ done 2026-09-28
- Result: branch `tripwire-hackathon`; build, typecheck, lint green; 211/211 tests.
- Found on the way and fixed: `zod` imported by the domain layer but never declared;
  characterization goldens guessed rather than recorded (tax net −9.39 → recorded −6.75,
  slug descriptions → real ones); I7 violated — compression booked as a disposal, and
  SOL amounts re-derived with 18 decimals (1 SOL → 1e-9); `ContractRiskModal` crashed on
  calldata-only checks; the EVM adapter would have passed demo data off as real;
  AI descriptions returned fragments ("H") because thinking tokens exhausted a
  100-token budget. `src/App.tsx` (unrouted draft, 18 type errors) excluded from the
  typecheck, not deleted.
- Commit the in-progress tier work to a branch unchanged, so nothing is lost.
- Merge the redesign branch (`claude/x-threads-poster-48ff51`, commit `5d30501`) into it.
- Update Gemini model list (finding 5) with a fallback chain; test handler falls through
  on 404/503.
- *Done when:* `npm test` green; `POST /api/describe` returns a model-written sentence
  locally with the key.

**Stage 1 — Correct graduated guardian (M)** · depends on 0
- Fix the three tier bugs; DELAY as a real queue; escalate-only.
- Shared thresholds; cross-layer tests for every boundary (64/65, 84/85, 94/95).
- Mutation-test each tier property (as before: every mutant must be caught).
- *Done when:* contract tests + cross-layer tests pass; mutation run reports 0 survivors.

**Stage 2 — Scorer reuses Retold's contract risk (S)** · depends on 1
- `ContractRiskSummary` input + `contract_risk` signal; pluggable `apiClient` transport.
- *Done when:* a unit test shows an unverified, 1-day-old, upgradeable target raises the
  score into THROTTLE with no other anomaly; the browser path is unchanged (existing
  tests green).

**Stage 3 — Watcher → attestor loop, locally (M)** · depends on 2
- `scripts/tripwire/watch.ts` (poll ingress logs), `attest.ts` (single signer),
  `attack.ts` (scripted synthetic attacks: moderate → aggressive).
- First against the in-process EVM (`GuardianVM`), so it runs in CI.
- *Done when:* `npm run tripwire:demo:local` prints NONE → THROTTLE → FREEZE and a test
  asserts the on-chain tier after each attack.

**Stage 4 — Public testnet (M)** · depends on 3 · **needs the human (see §6)**
- Deploy `MockBridge` (ingress, Sepolia) and `TripwireGuardian` + `ProtectedVault`
  (egress, Base Sepolia) with viem; verify source on the explorers with the Etherscan key.
- Run the same demo against testnets.
- *Done when:* verified contract pages exist; the demo prints tx hashes a judge can open.

**Stage 5 — "Check before you sign" page (M)** · independent of 1–4 · ✅ done 2026-09-28
- `/check` page; fixtures for a benign ERC-20 transfer and an unlimited approval to a
  fresh unverified contract; I11: selectors sourced from EIP-20.
- *Done when:* the two fixtures render green and red with the stated reasons; no code
  path signs or sends.
- Result: `services/preSignCheck.ts` runs decode → `simulateTransactionPayload` →
  `explainContractIntel` (the pure half of `explainContractPermissionRisk`, split out so
  fixtures run the real logic) → flag-list check → badge. The approval's risk is read
  from the **spender** argument, not from `to` (the token). Red = a flagged address, or
  an unlimited allowance to a spender that is fresh (< 30 days), unverified, a plain
  wallet, or could not be checked; unlimited to a verified, long-lived spender is yellow.
  Scenarios live in `services/preSignScenarios.ts`, shared by the page and the tests:
  real EIP-20 calldata, synthetic explorer facts on placeholder addresses, labelled as
  such on the page. `src/testing/noSigning.test.ts` walks every module `/check` can reach
  and fails on any signing, sending or wallet-connect call (and proves it can see one).
  Optional AI wording goes through the existing `/api/describe`: the client sends the
  badge and reason ids only, and a reply with a digit or address is discarded (docs/06
  §4). Fixed on the way: the pre-sign simulation named the token as the spender, found
  "unlimited" by searching the whole calldata for f's, and threw on a malformed value
  (I8). 256/256 tests (45 new); typecheck and lint clean.

**Stage 6 — Pitch + docs (S)** · depends on all
- README scope table (🔨 built vs 🗺️ roadmap), ADR-012, docs/05 status, video.
- *Done when:* every claim in the README and pitch is either tested or marked roadmap.

## 5. Risks

- **Single signer** is the centralisation point. Name it first; 2-of-3 TSS is roadmap.
- **False positives under volatility** — tiers reduce the cost, don't remove it.
- **Public RPC limits / flakiness** during the live demo — keep the local run as backup.
- **Testnet funding** needs faucets that require login/CAPTCHA (human step).
- **Claims.** The vision docs include figures to verify or cut before judging:
  "72 hours" for the Arbitrum freeze (the source says ~2 days, "unusually fast");
  "$2.8B+ drained" (unsourced here); "sub-5ms inference" (only true with a trained
  model running — the plan itself says not to borrow the stat).

## 6. Decisions needed from the human

1. **Working copy.** Work in `/Users/aibek/Desktop/Chainstory` on a new branch, after
   committing the in-progress tier change as-is? (Default: yes.)
2. **ADR-012.** Approve Tripwire's operator write path (watcher + single-signer attestor
   in `scripts/tripwire/`, contracts on testnet) as a separate component outside the
   read-only analysis app, which stays I1/I2-compliant. AGENTS.md requires sign-off.
3. **Testnet key.** I generate a throwaway deployer key into the git-ignored `.env`
   (never holds real funds); you fund it from Sepolia + Base Sepolia faucets; you give
   an explicit go before anything is broadcast.

Out of scope (roadmap only): zkML/EZKL, DePIN sentinel mesh, threshold signatures,
Solana Anchor guardian, agentic bounties, trained ONNX classifier. The five other
project ideas (AgentWire, VoltStream, Factora, ProofCred, TrueShot) are not in scope.
