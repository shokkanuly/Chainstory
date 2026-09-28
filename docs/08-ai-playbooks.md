# 08 — AI Playbooks

Recipes for recurring tasks. Each one ends with the checks from `AGENTS.md` §7. Before any playbook: read `AGENTS.md`, find the current phase in `05-roadmap.md`,
and state in one or two lines what you are about to change and which layers it touches.

---

## P1. Add or fix a Solana protocol decoder

1. Get the **program ID from an official source** (protocol docs / verified explorer page). If you can't verify it: stop, write `TODO(verify)`, ask.
2. Add a registry entry in `src/chains/solana/registry/programs.ts`: `{ programId, protocol, source: <url>, verifiedAt: <date> }`.
3. Find 2–3 real mainnet txs that use it (swap / add liquidity / etc.). Record raw `getTransaction` JSON into `src/testing/fixtures/solana/<sig>.json`.
4. Check whether **balance-diff already gives correct amounts** (it usually does). Only add an instruction decoder if the *meaning* is ambiguous (e.g. add-liquidity vs swap).
5. Add a rule in `src/classify/rules/solana.ts` keyed on protocol + movement pattern. Output category + confidence + evidence.
6. Add golden expectation for each fixture (headline + slots).
7. Confirm the tax mapping for the category in `03-domain-model.md`; do not invent a new category without updating that table.
8. Run fuzz smoke test; update status in `05-roadmap.md` if it completes a checkbox.

## P2. Add or fix an EVM protocol decoder

1. Verify the contract address/ABI from official docs or a verified source. No guessed selectors (I11).
2. Add ABI/selector entry under `src/chains/evm/registry/`.
3. Record fixtures (tx + receipt logs). Add rule under `src/classify/rules/evm.ts`. Add golden. Confirm tax mapping.

## P3. Add a new chain

1. Decide family: `evm` (add chain config: CAIP-2 ID, explorer API, native asset, price coin ID) or a new family (needs an ADR and an adapter).
2. EVM chain: extend the chain registry and explorer config only; **no changes** to `tax/`, `classify/`, `risk/`.
3. New family: implement `ChainAdapter` (`02-architecture.md`), a `normalize()` that is pure, fixtures, and registry routing in `chains/registry.ts`.
4. If any shared module needs a chain-specific `if`, stop: the domain model needs to change instead (update `03`, ADR).

## P4. Add a story category

1. Add to the `Category` union in `src/domain`.
2. Add tax mapping row in `03-domain-model.md` **and** in `src/tax/events.ts` (same change).
3. Add a headline template and slots. Slots come from `NormalizedTx` only (I5).
4. Add rule(s) and fixtures. If ML labels change, update `ml/` label map and note model retrain needed.

## P5. Add a ZK Compression fixture

1. Use scripts under `scripts/fixtures/zk/` (local validator via Light CLI or devnet with a Photon provider). Verify current SDK API at `zkcompression.com` first.
2. Perform one operation per script: compress, compressed transfer, decompress, close (and compressed PDA ops in Phase 5).
3. Record: raw tx from `getTransactionWithCompressionInfo` + the subject address + expected Δstd/Δcmp.
4. Add golden stories and a property test (net across states).
5. Never commit keypairs or API keys; use throwaway devnet keys and redact URLs.

## P6. Change a tax rule

1. State the rule change and the reason. If it's a policy question (not a bug), stop and record it in `05-roadmap.md` open questions for human/professional review.
2. Update the mapping in `03-domain-model.md`, then code.
3. Add/adjust a hand-computed spreadsheet fixture; the expected numbers come from the spreadsheet, not from running the code.
4. Run property tests. Any golden diff must be explained line by line.

## P7. Investigate "the story is wrong"

1. Get the tx ID and load its raw fixture (or record one).
2. Check in order: (a) raw parse/validation, (b) `normalize()` output — are movements right? (c) classification evidence, (d) story template/slots, (e) LLM narrative (should never be the cause of a wrong number).
3. Fix at the **earliest broken stage**. Add the tx as a regression fixture **before** the fix.

## P8. Integrate a new external API

1. Ask before adding dependencies. Wrap the API in an adapter-level client with zod validation, timeout, `AbortSignal`, throttle/backoff via `chains/http.ts`.
2. Add recorded-response tests for success, 429, 5xx, malformed JSON.
3. Document key handling in Settings and `06`. Update the privacy statement if new data is sent to a new party.

## P9. Update documentation

- Change a contract → update its doc in the same change (`03` for types, `02` for adapter/pipeline, `05` for status, `07` for a decision).
- New decision with trade-offs → new ADR entry (append; supersede, don't rewrite).
- Unverified fact → `TODO(verify)` with the source to check.

---

## Prompt template for handing a task to an AI agent

```
Task: <one sentence>
Phase: <from docs/05-roadmap.md>
Layers touched: <app | domain | chains/evm | chains/solana | classify | pricing | tax | risk>
Playbook: <P1..P9>
Constraints: obey AGENTS.md invariants I1–I12; no new dependencies without asking.
Done when: <checkable criteria, ideally a fixture/test that must pass>
Before coding: state what you found in the existing code and any deviation you propose.
```
