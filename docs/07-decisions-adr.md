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
