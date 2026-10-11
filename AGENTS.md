# AGENTS.md — ChainStory

> Entry point for AI coding agents. Read this file completely before changing anything.
> Humans: start at `docs/README.md`.

## 1. What this project is

ChainStory is a **client-side wallet intelligence engine**. Given an address or name, it fetches on-chain history,
normalizes it into a chain-agnostic model, translates it into plain-English "stories", and computes draft tax
(FIFO / Form 8949), wallet reputation, and security risk.

- **v1 (exists):** 5 EVM chains (Ethereum, Arbitrum, Base, Optimism, Polygon).
- **v2 (planned, see `docs/05-roadmap.md`):** Solana (SVM), including ZK-compressed state (Light Protocol / Photon indexer).
- **Stack:** React 19, TypeScript (strict), Vite, Tailwind v4, Framer Motion, `idb`, `onnxruntime-web`, optional Gemini.
  Python training scripts in `ml/`. Rust/Anchor in `programs/` (Phase 5 only, optional).
- **Shape:** browser SPA, plus two stateless key proxies (`/api/explorer`, `/api/describe`; ADR-013). No database, no accounts,
  no wallet connection, no custody.

## 2. Read order before you code

1. `docs/02-architecture.md` — layers, dependency rules, adapter contract
2. `docs/03-domain-model.md` — the types every module agrees on
3. `docs/05-roadmap.md` — find the **current phase**; work only inside it unless told otherwise
4. The topic doc for your task: `04-solana-and-zk-compression.md`, `06-quality-security-privacy.md`
5. `docs/08-ai-playbooks.md` — step-by-step recipes for common tasks

## 3. Hard invariants

If a task requires breaking one, **stop and ask the human**. Do not "work around" an invariant.

| # | Invariant | Why |
|---|-----------|-----|
| I1 | The analysis app is **read-only and non-custodial**: no signing, no private keys, no wallet-connect, no sending txs. | Trust model; smaller attack surface. |
| I2 | **No ChainStory backend that stores anything.** The browser talks to third-party APIs, and to the two stateless, allowlisted key proxies in `server/` (ADR-013). Any other server component, or any state on the server, needs an ADR. | Core product promise. |
| I3 | Money is `bigint` base units + `decimals`. **Never floats for amounts.** USD uses a decimal library or fixed-point strings. | Rounding errors in tax = wrong filings. |
| I4 | Chain-specific knowledge lives only in `src/chains/<chain>/`. Everything else consumes `NormalizedTx` from `src/domain`. | Adding a chain must not touch tax/classify/UI. |
| I5 | Numbers, assets, and counterparties in a story come from **structured data**, never from LLM text. The LLM only phrases. | Prevents hallucinated amounts. |
| I6 | The tax engine consumes **deterministic** classification only (rules/ML above threshold, or user override). Never LLM output. Low confidence → `unclassified`, flagged for review, never guessed. | Tax correctness and auditability. |
| I7 | Compress/decompress, wrap/unwrap (wSOL/WETH), and transfers between the user's own wallets are **not taxable disposals**. | Prevents phantom gains. |
| I8 | Unknown program / instruction / protocol version → generic story + low confidence. **Never throw** on unknown input. | Protocols evolve faster than we ship. |
| I9 | Any accusation (drainer, sandwich, sanctioned, rug) carries an **evidence list** and follows the wording policy in `docs/06`. | False accusations are harmful. |
| I10 | API keys are never in the client bundle (no `VITE_*` keys), never logged, never committed. The explorer and Gemini keys live only in server env (ADR-013); other provider keys (Solana/Photon) are user-supplied and stored locally. | Secrets hygiene. |
| I11 | **No invented protocol facts.** Function selectors, program IDs, tip accounts, RPC method names come from official docs or a recorded fixture. Otherwise write `TODO(verify)`. | AI-typical failure mode. |
| I12 | All external responses (RPC, indexer, price, LLM) are **untrusted input**: validate with `zod` at the adapter boundary. On-chain strings (token names, memos) are attacker-controlled. | Injection, crashes. |

## 4. Layer map and dependency rules

```
src/
├── app/        React UI. Only layer allowed to import React.
├── domain/     Pure types, zod schemas, enums. No I/O. Imports nothing from src/.
├── chains/     ChainAdapter interface + registry + evm/ + solana/. Only place with chain-specific code.
├── classify/   rules → ONNX → LLM orchestration. Depends on domain only.
├── pricing/    DefiLlama / CoinGecko + IndexedDB cache. Depends on domain only.
├── tax/        FIFO engine, Form 8949 export. Depends on domain only.
├── risk/       reputation, counterparty screening. Depends on domain only.
├── storage/    idb + localStorage wrappers.
└── testing/    fixtures (recorded real data) + golden outputs.
```

Allowed imports: `app → {chains, classify, pricing, tax, risk, storage, domain}`; everything else `→ domain`.
**Forbidden:** `chains/evm ↔ chains/solana`; `tax|classify|risk|pricing → chains/*`; anything except `app` importing React.
Existing file names (`evmIndexer.ts`, `abiDecoder.ts`, `mlClassifier.ts`, `b2bSimulation.ts`) are kept when moved.

## 5. Conventions

- TypeScript `strict`; no `any`; no non-null `!` outside tests. Prefer discriminated unions over class hierarchies.
- Adapters return typed results (`{ ok: true, value } | { ok: false, error }`) for expected failures (rate limit, missing indexer).
  Throw only for programmer errors.
- Every network call: `AbortSignal`, shared throttle + exponential backoff (`src/chains/http.ts`), no ad-hoc `fetch` in feature code.
- `normalize()` functions are **pure** (no network, no clock, no randomness) so fixtures can test them.
- Follow the naming and folder style already in the touched area. Deviations must be listed in the PR description.
- Do not add dependencies without asking. Proposed new dev-dependency already flagged in ADR-003: a boundary linter.

## 6. Commands

Confirm real scripts with `cat package.json` — do not assume. Target scripts (created in roadmap Phase 0):
`dev`, `build`, `typecheck`, `lint` (includes boundary rules), `test`, `test:golden`.

## 7. Definition of done (every change)

- [ ] Typecheck, lint, and tests pass locally.
- [ ] New/changed behavior has a fixture-based test. Bug fixes add a regression fixture first.
- [ ] `test:golden` diff is either empty or every change is explained in the PR.
- [ ] No invariant (I1–I12) touched; if touched, human approved.
- [ ] Docs updated in the same change (`docs/05-roadmap.md` status table, and any doc whose contract you changed).
- [ ] Deviations from existing patterns are stated explicitly.

## 8. Do NOT

- Do not refactor unrelated code while doing a task.
- Do not add a second way to do something the codebase already does one way.
- Do not put Solana logic in EVM files or vice versa.
- Do not call an LLM from `tax/` or `domain/`.
- Do not hardcode program IDs, selectors, or tip accounts inline: use `chains/<chain>/registry/`.
- Do not write "protected by Jito" / "sandwiched" / "drainer" in UI copy without going through the evidence and wording policy.
- Do not claim "no data leaves your device" in copy. The accurate claim is in `docs/06` §Privacy.

## 9. When unsure

1. Check the docs above. 2. Search official docs (`zkcompression.com`, Solana docs, protocol docs) — never guess.
3. Ask the human one specific question and state your default assumption. 4. Record the resolution in `docs/07-decisions-adr.md`.

## 10. Tripwire continuation and delivery

For Tripwire implementation, read `docs/plans/tripwire-progress.md` and
`docs/plans/tripwire-handoff.md` after the required read order above. The progress
file is the current checkpoint; the handoff contains the larger plan and historical
evidence. Do not mark a manual/live/audit gate complete using synthetic tests.

Commit and push each completed implementation step to your own working branch
and open a PR into `main`; do not push to a teammate's branch or straight to
`main`. Start from current `main` (it carries policy v4; ADR-046) and merge
`main` back in before you push again. Include the updated checkpoint and relevant
runbooks in that step's commit. Record behavior, checks, remaining limits and the
exact next task before committing. Verify the remote branch SHA after pushing.
Preserve concurrent teammate changes; no force push on a shared branch. Do not
include wallets, `.env*`, `.tripwire/`, signed outboxes or SQLite journals. If
delivery fails, record the local commit and report the failure instead of
claiming it is on GitHub.

## 11. Glossary

See `docs/09-glossary.md` (Solana, ZK Compression, and tax terms). Key: **NormalizedTx**, **Story**, **TaxEvent**, **Adapter**,
**Photon**, **validity proof**, **state tree**, **balance-diff**.
