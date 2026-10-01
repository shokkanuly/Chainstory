# 07 — Decision Log (ADR)

Format: **Context → Decision → Consequences → Revisit when.** Add new entries at the bottom; never rewrite history, supersede instead.

---

### ADR-001 — One product, not two
**Context:** Two planned efforts (EVM narrative/tax engine; Solana ZK Compression build).
**Decision:** Ship as ChainStory v2. Compressed-state explanation is a feature of the narrative engine.
**Consequences:** Shared UX, shared tax/reputation; Solana code must not leak into EVM modules.
**Revisit when:** Solana-specific needs (e.g. server indexing) contradict I2.

### ADR-002 — Stay a Vite React SPA (no Next.js)
**Context:** Source notes suggested Next.js App Router for the ZK build.
**Decision:** Keep React 19 + Vite. No SSR needed for a client-only tool.
**Consequences:** No framework migration cost; Photon calls are browser-side with user keys.
**Revisit when:** SEO/share-card rendering or server components become a real requirement.

### ADR-003 — Modules with enforced boundaries, not a monorepo (yet)
**Context:** Need isolation between chains and between domain and I/O.
**Decision:** Single package; folder layers; **boundary linter** (`eslint-plugin-boundaries` or `dependency-cruiser` — new dev-dependency, needs owner approval).
**Consequences:** Lower tooling cost; discipline enforced by CI rather than by package walls.
**Revisit when:** Build times or team size demand independent versioning, or a second app (e.g. attest UI) needs to share code.

### ADR-004 — Chain-agnostic `NormalizedTx` as the only seam
**Context:** Tax, classify, risk, pricing must not know about chains.
**Decision:** Adapters output `NormalizedTx` (`03`). CAIP-2 chain IDs; asset keys chain-qualified; compressed and standard tokens share an asset key.
**Consequences:** Some chain nuance becomes tags/roles; the model needs care when extended (change = update docs + all consumers).
**Revisit when:** A chain cannot be expressed without leaking (e.g. UTXO chains).

### ADR-005 — Balance-diff first for Solana
**Context:** Solana has no transfer logs; program decoding is unbounded work.
**Decision:** Amounts come from pre/post balances (and Photon compression info); program registry/decoders add meaning, never amounts.
**Consequences:** Correct amounts even for unknown programs; less protocol-specific detail until decoders exist.
**Revisit when:** A common protocol's semantics can't be inferred from diffs (e.g. some liquidity ops).

### ADR-006 — Provider abstraction and user-supplied keys
**Context:** No backend (I2); Photon needs a capable provider and usually a key.
**Decision:** `SolanaRpc` and `PhotonClient` take endpoints from Settings; degrade gracefully without Photon; no shared proxy.
**Consequences:** Users must bring keys; onboarding UX matters. No central rate control.
**Revisit when:** Adoption is blocked by key friction → consider an ADR-backed proxy (would be a deliberate I2 exception).

### ADR-007 — LLM off the critical path
**Context:** LLM prose is nice but nondeterministic and injectable.
**Decision:** Rules/ML classify; LLM only phrases from structured slots; never used in tax or risk verdicts; opt-in with data preview.
**Consequences:** Stories are reproducible offline; LLM stories are additive polish.
**Revisit when:** A validated on-device model can replace the cloud LLM.

### ADR-008 — `story-attest` is experimental and physically separated
**Context:** Writing to chain requires signing (conflicts with I1) and adds security surface.
**Decision:** Live in `programs/` + `scripts/attest/`, not the analysis bundle; gated by Phase 5 criteria and kill criteria.
**Consequences:** The read path never depends on it; effort only spent if a consumer exists.
**Revisit when:** A concrete consumer appears, or at the end of Phase 4 (drop if none).

### ADR-009 — Drop Firedancer/multi-client tooling; reframe "agent"
**Context:** Source notes listed Firedancer tooling and an AI agent that "blocks" drainers.
**Decision:** Firedancer is out of scope. The "agent" becomes **Guard**: read-only simulation + explanation + warnings (Phase 4).
**Consequences:** Scope stays coherent with a wallet-narrative product; no false promise of blocking.
**Revisit when:** A real integration point with signers exists (wallet extension) — separate product decision.

### ADR-010 — Compressed NFTs (Bubblegum) excluded from ZK Compression work
**Context:** Two different "compression" systems exist on Solana.
**Decision:** ZK Compression (Light) only, for now. cNFT support (DAS API) is a separate later item.
**Consequences:** Avoids conflating mechanisms in code and UI copy.
**Revisit when:** User demand for NFT history on Solana.

### ADR-011 — Numbers from code, words from models
**Context:** Hallucinated amounts in a financial tool are unacceptable.
**Decision:** Story headlines are templates with structured slots; LLM narrative is discarded if it introduces numbers/entities not in slots.
**Consequences:** Slightly less fluent prose; verifiable output.
**Revisit when:** Never for tax; possibly for purely decorative text.

### ADR-012 — Tripwire's write path is an operator component, outside the analysis app
**Context:** Tripwire must sign attestations and change on-chain state (pause, throttle, delay a bridge route). I1 makes the analysis app read-only; I2 forbids a ChainStory backend.
**Decision:** The write path — watcher, single-signer attestor, deploy scripts — lives in `scripts/tripwire/` and `contracts/`, run by a bridge operator. The analysis app never imports it, holds a key, or sends a transaction, so I1 and I2 still hold for the app. The attestation key is a throwaway testnet key in a git-ignored `.env`.
**Consequences:** One product, two runtimes: the browser app (read-only) and an operator process (writes). Single signer is a named centralisation point; 2-of-3 threshold signing is the production path.
**Revisit when:** Any code in `src/app` or the browser bundle needs a key, or the attestor moves to hosted infrastructure.
**Approved:** by the human, 2026-09-28.

### ADR-013 — A narrow, stateless key proxy for the EVM explorer and Gemini (an exception to I2 and I10)
**Status:** Approved by the human, 2026-09-28. Records code already in `api/` and `server/`. Supersedes ADR-006's "no shared proxy" for the EVM explorer and Gemini.
**Context:** Vite inlines every `VITE_*` variable into the client bundle, so the earlier build shipped the explorer and Gemini keys to every visitor. Moving them server side was a security fix, and it created `api/` + `server/` (Vercel functions). That contradicts I2 ("No ChainStory backend") and I10 ("API keys are user-supplied, stored locally"), and nothing recorded the exception. ADR-006 anticipated it: "consider an ADR-backed proxy (would be a deliberate I2 exception)".
**Decision:** Allow exactly two stateless functions, and nothing else server side:
- `/api/explorer` (`server/explorerHandler.ts`): Etherscan V2 only; an allowlist of module/action pairs, each parameter validated; ENS resolution built server side rather than a general `eth_call`.
- `/api/describe` (`server/geminiHandler.ts`): the prompt is assembled server side from structured fields, never sent by the client. The `/check` wording (`server/checkPhrasing.ts`) accepts only a badge and reason ids from a closed set.

Keys are server environment variables (`ETHERSCAN_API_KEY`, `GEMINI_API_KEY`), never `VITE_*`. No database, no accounts, no stored requests; a per-IP, in-memory rate limit. The same handlers run in the Vite dev server (`server/devPlugin.ts`) and in-process for Node (`server/explorerTransport.ts`, for the Tripwire watcher), so there is one code path. Solana / Photon keys stay user-supplied (ADR-006).
**Consequences:**
- "No backend" becomes "no backend that stores anything": two stateless proxies we pay for and must keep within quota. The in-memory limiter resets per instance and is not shared, so it stops casual scraping, not a determined attacker.
- Every explorer lookup now passes through our origin, so the host sees the requesting IP and the address looked up, and host request logs can record both. The privacy copy in `docs/06` §2 ("ChainStory has no server") is no longer true and must change with this ADR.
- With no key configured each path degrades rather than fails: explorer → 503 → labelled demo data or "unchecked"; describe → 503 → deterministic text.
- Found while writing this, not changed: `services/descriptionGenerator.ts` sends full `from`/`to` addresses and values to `/api/describe` for every classified transaction, automatically. `docs/06` §2 promises the LLM feature is opt-in, off by default, with a preview, and sends truncated addresses only. The `/check` wording sends no user data (fixed phrases only), so it is not affected. **Resolved 2026-09-29, by the human's decision:** AI descriptions are now opt-in, off by default, with a preview, and send shortened addresses only (`services/aiDescriptions.ts`); `docs/06` §2 describes the new behaviour.
**Reworded on approval (2026-09-28):** AGENTS.md §1 "Shape", I2 and I10; `docs/01` principle 1; `docs/02` "Browser-only means keys are user-supplied"; `docs/06` §2 privacy copy and §3 keys; and ADR-006 is superseded here rather than edited, per this log's rule.
**Revisit when:** a user-supplied-key mode is wanted again (restore Settings keys, keep the proxy as the fallback), or the proxy needs state (a cache, accounts, stored results) — that would be a real backend and needs its own ADR.

### ADR-014 — Tripwire release reviews are mandatory before demo payouts
**Status:** Authorized by the human's instruction to start the Tripwire hardening plan, 2026-09-30.
**Context:** The scripted demo waited for scoring and route protection, but ProtectedVault itself allowed anybody to execute a requested release first. Missing source data was also scored as a verified absence.
**Decision:** Add an oracle-signed, short-lived per-release review to the demo vault. Sign every payout field, its minimum guardian tier, and a monotonically increasing per-message nonce in a vault/chain-bound EIP-712 domain. PENDING and HELD requests cannot execute; REJECT is terminal. Fresh ALLOW still requires guardian protection and SafeERC20 transfer. All real signing stays in the operator scripts (ADR-012); no browser app signing, new dependencies, backend or persistent storage is added.
**Trust boundary:** The release reviewer can permit already requested payouts, a broader role than the guardian's tighten-only attestation. This review does not authenticate the bridge message or independently verify source-chain consensus. Production bridges must retain independent message/source verification. The demo source remains explicitly synthetic. Oracle rotation invalidates old execution allowances.
**Failure policy:** An unconfigured, unavailable or malformed source verifier means hold/retry. Only explicit independently established invalid backing may produce a terminal source rejection. Conflicting observed logs require reconciliation. Backing arithmetic is bigint; illustrative USD behavioral heuristics and incident reconstruction retain their earlier approximate representation.
**Consequences:** The gated vault must be freshly deployed; the recorded Sepolia vault is unchanged. Local tests and demo run actual vault bytecode. The operator must confirm required risk protection and review receipts before execution, then maintain durable retry state in the next milestone. The browser guardian replay is unchanged and does not demonstrate this vault gate.
**Revisit when:** selecting the first real bridge adapter, implementing durable operator state, replacing the single reviewer or changing the review/delay recovery policy. See [hardening plan](plans/tripwire-hardening.md).

### ADR-015 — Durable Tripwire operator state and signed transaction outbox
**Status:** Authorized by the human's instruction to continue the Tripwire hardening plan, 2026-09-30.
**Context:** In-memory watcher cursors could advance before a request was durably queued; a process restart lost pending/held/delayed work. Broadcasting before recording a transaction left its outcome ambiguous after a crash.
**Decision:** Add an operator-only SQLite store under `scripts/tripwire/`, using the existing Node runtime's `node:sqlite` (Node ≥22.13; no npm dependency). Store both feed cursors, validated events, pending/completed requests, conflicts and exact release history in one atomic snapshot. Amounts remain bigint at runtime and canonical decimal strings in storage. Use WAL with `synchronous=FULL`. Bind schema version and deployment scope (route, both chain IDs, source/vault/guardian/token, decimals and transaction sender); reject incompatible or malformed state rather than reset it.
**Ownership:** One operator per state file. A separate SQLite database holds an EXCLUSIVE transaction for the process lifetime, so competing operators fail and process death releases the lock automatically. This assumes one stable state-file path on a local filesystem; do not rename/delete the database or its `.lease` file while running. Browser analysis and stateless proxies have no database, keys or access to operator state (I1/I2 remain unchanged for those runtimes).
**Submission policy:** Prepare/sign locally, validate the signed transaction's chain/sender/payload/hash and durably record its original bytes before broadcasting. Recovery checks the original hash for a receipt, otherwise rebroadcasts identical bytes; no fresh nonce/transaction is allocated while a signed job is outstanding. Actual receipts resolve confirmed/reverted states. RPC errors/timeouts remain outstanding; a revert is recorded, never treated as success. The durable release runner acknowledges only matching on-chain EXECUTED/REJECTED states. HOLD and guardian-delayed releases remain pending and are reassessed, with fresh short-lived reviews for retries.
**Consequences:** This is persistent bridge-operator state, not a hosted ChainStory backend. Signed transactions are sensitive authorization material: local files are mode 0600 and ignored by Git. Snapshot storage is suitable for a single-route pilot; compaction/indexed state, gas replacement, competing external senders and multi-process operation remain future work. Receipt recovery does not establish canonical-chain finality: block-hash reconciliation/reorg handling is still a separate P0 milestone. Pending ALLOW bytes retain their signed TTL during recovery; they cannot bypass the vault's review expiry, signer binding or guardian checks.
**Validation:** Failure injection before/after writes and broadcasts, wrong scope/corrupt schema, exact large amounts, HOLD/delay recovery, repeated-operation deduplication, receipt persistence failure, and real SIGKILL before/after a SQLite commit. The existing public deployment is unchanged. The standalone Sepolia runner has no invented source proof/baseline and therefore holds unchecked requests; see [operator runbook](plans/tripwire-operator.md).
**Revisit when:** selecting a real bridge adapter, adding finality/reorg handling, scaling beyond one operator, rotating the transaction sender, or hosting operator infrastructure.

### ADR-016 — Finalized RPC observations, staged receipts and durable quarantine
**Status:** Authorized by the human's instruction to continue Tripwire hardening, 2026-09-30. Supersedes ADR-015's receipt-only completion policy for real-chain operator ports.
**Context:** A latest-chain log or first receipt may disappear in a reorg. Waiting for every review receipt to become finalized would consume the vault's short review TTL before execution. Recovering signed ALLOW/payout work before checking source anchors could also publish an authorization after the source history changed.
**Decision:** The standalone Ethereum/Sepolia operator ingests only the RPC's `finalized` range. Validate hash-linked headers (64-block chunks), log identity/contract/range and block/transaction provenance. Persist chain/contract/event/start-bound checkpoints with the observations. Revalidate committed anchors before recovery, signing, broadcasting and terminal acknowledgement. The explicit `local` mode is for fixture ports; `finalized` ports require canonical finality, publication-safety and conflict handlers, and bind that policy in the database scope.
**Receipt stages:** Persist signed → included → finalized confirmed/reverted. Canonical inclusion is sufficient to continue guardian/review/execution within the signed TTL; EXECUTED/REJECTED is acknowledged only from matching state at a hash-checked finalized block. Included reverts remain nonterminal until finalized. Ordinary unfinalized receipt reorgs reopen the original signed transaction, retain the orphaned receipt anchor and rebroadcast identical bytes. Missing receipts on a still-canonical block are RPC unavailability, not proof of a reorg. A finalized revert permits an explicitly numbered fresh review attempt; unresolved/confirmed attempts are not silently overwritten.
**Finality conflict:** Changed committed finalized source/destination or transaction block hashes persist a quarantine, discard cached backing/behavioral history and retain the queue/checkpoints/transaction bytes for investigation. Automatic verification, signing, publication and acknowledgements stop, including on restart. A finalized-history conflict is not auto-rewound or auto-resumed: consensus/provider reconciliation must precede an explicit migration and rescan. Existing broadcast signatures and on-chain allowances remain governed by their TTL and guardian; off-chain quarantine cannot instantly undo them or an already executed payout.
**Storage compatibility:** Schema v2 adds origin/checkpoint, included receipt/audit, finality-mode and quarantine contracts. V1 is refused without mutation/reset of its queue. Existing active operators must stop and reconcile/back up old signed work before an explicit migration; changing filenames to skip the error can hide outstanding nonces. No live operator/database migration or public deployment was performed here.
**Trust boundary:** This validates the provider's internally consistent canonical/finalized answers. It is not an Ethereum consensus light client, independent source proof, bridge-message authentication or a guarantee against a dishonest RPC. Real bridge and rollup finality require their own adapter policy; never substitute a generic block count or fall back to latest when finalized is unsupported. The scripted fast demo still uses instant synthetic observations explicitly.
**Validation:** Finalized-only ingestion/provenance, hash-linked headers, stale/unsupported RPC, restart anchor conflicts, staged receipt finality, orphaned raw-byte recovery, missing canonical receipts, late publication checks, durable quarantine, final terminal-state acknowledgement, legacy schema refusal and finalized review-revert retries. See the [operator runbook](plans/tripwire-operator.md).
