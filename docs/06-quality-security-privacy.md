# 06 — Quality, Security, Privacy

## 1. Testing strategy

| Layer | What is tested | How |
|-------|----------------|-----|
| `normalize()` (pure) | Raw → `NormalizedTx` | **Fixtures**: recorded real RPC/Photon responses in `src/testing/fixtures/<chain>/<hash>.json`; expected output in `golden/` |
| Classification rules | Category/confidence | Table-driven tests over normalized fixtures |
| Story rendering | Headline slots | Snapshot of `headline` + `slots` (never snapshot LLM prose) |
| Tax engine | FIFO, short/long-term, income, fees | Hand-computed spreadsheets as fixtures + **property tests** |
| Adapters (network) | Paging, backoff, 429, malformed JSON | Mock server / recorded responses |
| Robustness | No crashes on unknown input | **Fuzz**: mutate fixtures (drop fields, unknown program IDs, huge values) → expect generic story or `unparsed`, never an exception |
| Solana ZK | Compress/transfer/decompress ground truth | `scripts/fixtures/zk/` records real devnet/local txs |

**Property tests (tax):** lot quantity never negative; Σ(acquire) − Σ(dispose) = remaining lots; FIFO order respected; compress→decompress leaves lots and basis unchanged;
adding an unrelated tx does not change other assets' results; all arithmetic is `bigint`/decimal (assert no `number` amounts).

**Fixture hygiene:** fixtures contain only public chain data; strip API keys from recorded URLs; each fixture has a `README` line: what it demonstrates and how it was obtained.

**CI gates:** typecheck, lint (incl. boundaries), unit, property, golden diff, fuzz smoke. A golden diff must be explained in the PR.

## 2. Privacy: accurate claims

Do **not** write "no private data leaves your device." Say:

> Retold has no accounts and stores nothing on a server. Your analysis runs in your browser. To fetch history and contract facts, **the addresses you look up
> pass through our server to the block explorer** (Etherscan), because that is where the API key lives; our host can see your IP address and those lookups.
> Prices come from public price APIs. When AI descriptions are available, **transaction details, including addresses and amounts, are sent through our server
> to Google Gemini**. Watchlists are stored only in your browser.

**Known gap (open decision, ADR-013):** the two rules below are the target, and `services/descriptionGenerator.ts` does not meet them today — it sends full
addresses automatically, with no opt-in. Until that is decided, the statement above is the accurate one. `/check`'s AI wording sends no user data.

Rules:
- LLM feature is **opt-in**, off by default, with a visible indicator and a "what is sent" preview.
- Summary sent to the LLM contains asset symbols/amounts/categories and truncated addresses only; no user labels, no notes.
- No analytics or third-party scripts without an ADR.

## 3. Secrets and keys

- The explorer and Gemini keys are server environment variables, never `VITE_*` (ADR-013). Other provider keys are user-supplied (Settings), stored in `localStorage`, redacted in logs, excluded from error reports and shareable URLs.
- A bundled key is only allowed for a hosted demo, must be domain-restricted and low-quota.
- `.env*` and recorded fixtures are checked by a pre-commit secret scan.

## 4. Untrusted input and LLM safety

On-chain strings (token names/symbols, NFT metadata, memos, program-emitted logs) are **attacker-controlled**.

- Validate everything at the adapter boundary with zod; cap string lengths; strip control/bidi characters before display.
- Render as text, never as HTML.
- LLM prompt design: on-chain strings are passed as **quoted data fields**, never as instructions; the model has **no tools**; output is JSON-schema validated;
  any number/asset/address in the output that is not present in the input slots causes the narrative to be **discarded** (fallback to template headline). (I5)
- The model never decides tax category or risk verdicts (I6, I9).

## 5. Wording policy for claims (I9)

| Situation | Allowed | Not allowed |
|-----------|---------|-------------|
| Address on a vetted exploiter/sanctions list | "Appears on `<list name>` (source, date)" with link | "This is a scammer/criminal" |
| Heuristic drainer pattern | "Matches a pattern associated with wallet-drainer approvals" + evidence | "This is a drainer" |
| Jito tip present | "Included a Jito tip — likely sent via a Jito bundle" | "Protected from MEV" |
| Sandwich heuristic | "Possible sandwich pattern (low/medium/high confidence)" + tx signatures | "You lost 1.8% to a sandwich attack" |
| Contract risk | "Upgrade authority is set: the program can be changed by `<key>`" | "This project is a rug" |
| Tax | "Draft calculation — not tax advice" on every export | "Your tax owed is X" |

Every warning has `evidence[]`; the UI can expand it. Every list-based flag shows list name and last-updated date.

## 6. Tax disclaimer and review

- Every screen and export containing tax figures carries a "draft, not tax advice" label.
- Policy choices (e.g. staking receipts, rent, bridging) are recorded in `07` and reviewed by a qualified tax professional before being marked stable.
- Rows with missing prices or unclassified transactions are excluded from totals and listed explicitly.

## 7. Supply chain and build

- Pin dependency versions; review new dependencies (ask before adding).
- ONNX model files are versioned with checksum; the app verifies the checksum before loading.
- Any Rust program (Phase 5) requires: no `unsafe` without justification, account-ownership and signer checks, tests for failure paths, and an external review before mainnet.

## 8. Phase 5 security checklist (attest program)

- [ ] Every account validated (owner, signer, discriminator); PDA/address derivation deterministic and documented.
- [ ] Validity-proof verification delegated to the Light system program via the official SDK (no custom verification).
- [ ] Replay/duplicate receipts prevented (unique address per `(wallet, snapshotId)`).
- [ ] No PII or reversible data in commitments; schema versioned.
- [ ] Authority key handling documented; upgrade authority policy decided (immutable vs. multisig).
- [ ] Failure paths tested: stale proof, indexer lag, wrong tree, oversized tx.
