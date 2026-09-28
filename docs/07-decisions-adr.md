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
- Found while writing this, not changed: `services/descriptionGenerator.ts` sends full `from`/`to` addresses and values to `/api/describe` for every classified transaction, automatically. `docs/06` §2 promises the LLM feature is opt-in, off by default, with a preview, and sends truncated addresses only. The `/check` wording sends no user data (fixed phrases only), so it is not affected.
**Reworded on approval (2026-09-28):** AGENTS.md §1 "Shape", I2 and I10; `docs/01` principle 1; `docs/02` "Browser-only means keys are user-supplied"; `docs/06` §2 privacy copy and §3 keys; and ADR-006 is superseded here rather than edited, per this log's rule.
**Revisit when:** a user-supplied-key mode is wanted again (restore Settings keys, keep the proxy as the fallback), or the proxy needs state (a cache, accounts, stored results) — that would be a real backend and needs its own ADR.
