# 02 — Architecture

## Design goal

Adding Solana must **not** change tax, classification, risk, pricing, or most of the UI. The way to achieve that is one
narrow, chain-agnostic seam: `NormalizedTx` (see `03-domain-model.md`), produced by per-chain adapters.

## Approaches considered

| Option | How | Cost | Verdict |
|--------|-----|------|---------|
| A. Bolt Solana onto EVM modules (`if (chain === 'solana')` everywhere) | Fastest first demo | Tax/UI become chain-aware; every future chain multiplies branching | Rejected |
| B. Full monorepo with many npm packages now | Strong isolation | Tooling overhead for a small team; refactor risk before value | Deferred (revisit trigger in ADR-003) |
| C. **Single app, modules with enforced import boundaries, chain adapters, shared domain model** | Isolation without packaging overhead | Needs a boundary linter + discipline | **Chosen** |

## Layers

```
src/
├── app/        UI: routes, components, hooks. Only layer that imports React.
├── domain/     Types + zod schemas: NormalizedTx, AssetMovement, Story, TaxEvent, ChainId. Pure.
├── chains/
│   ├── types.ts      ChainAdapter interface
│   ├── registry.ts   address → adapter routing
│   ├── http.ts       shared fetch: throttle, backoff, AbortSignal
│   ├── evm/          evmIndexer.ts, abiDecoder.ts, approvals.ts, preScan.ts, registry/
│   └── solana/       rpc.ts, photon.ts, signatures.ts, normalize/, decoders/, registry/, jito.ts, risk.ts
├── classify/   rules.ts → mlClassifier.ts (ONNX) → llm.ts (Gemini) + orchestrator.ts
├── pricing/    defillama.ts, coingecko.ts, cache.ts (IndexedDB)
├── tax/        fifo.ts, events.ts, form8949.ts, export.ts
├── risk/       reputation.ts, counterparties.ts
├── storage/    idb.ts, watchlist.ts
└── testing/    fixtures/, golden/
programs/       story-attest (Rust/Anchor + Light SDK)   — Phase 5, optional, NOT bundled into the web app
scripts/        fixtures/zk (create compressed txs on devnet/local), attest CLI
ml/             Python training (XGBoost → ONNX), unchanged
```

**Dependency rules** (enforced by lint, ADR-003): `app` may import everything; every other layer imports only `domain`
(plus `storage` where noted). No cross-imports between `chains/evm` and `chains/solana`. Nothing outside `app` imports React.

## Chain adapter contract

```ts
export interface ChainAdapter {
  readonly family: 'evm' | 'svm';
  readonly chains: ChainId[];                                   // CAIP-2, e.g. 'eip155:1', 'solana:mainnet'

  canHandle(input: string): AddressMatch | null;                // syntactic: 0x… / base58 / ENS / .sol
  resolve?(input: string, ctx: AdapterCtx): Promise<Result<ResolvedAddress>>;

  fetchHistory(q: HistoryQuery, ctx: AdapterCtx): AsyncIterable<Result<HistoryPage>>; // paged, resumable, abortable
  normalize(raw: RawTx, subject: Address, ctx: NormalizeCtx): NormalizedTx;           // PURE

  auditPermissions(subject: Address, ctx: AdapterCtx): Promise<Result<PermissionFinding[]>>;
  scanContract(target: Address, ctx: AdapterCtx): Promise<Result<ContractRiskReport>>;
  simulate?(payload: SimulationInput, subject: Address, ctx: AdapterCtx): Promise<Result<SimulationResult>>; // Phase 4
}
```

Rules: `normalize` is pure and only sees data already fetched (so fixtures fully test it). `fetchHistory` yields pages so the UI
renders progressively. Adapters never return prices, stories, or tax data.

## Pipeline

```
resolve → fetchHistory (paged) → normalize → price (batched) → classify → { stories, taxEvents } → views
```

| Stage | Input → Output | Notes |
|-------|----------------|-------|
| resolve | user string → `ResolvedAddress` | ENS (EVM), `.sol` via SNS (later) |
| fetch | address → `RawTx` pages | Rate-limit aware; resumable by cursor |
| normalize | `RawTx` → `NormalizedTx` | Pure; per chain |
| price | assets × timestamps → USD | Batch by (asset, day); IndexedDB cache; missing price = explicit `null`, never `0` |
| classify | `NormalizedTx` → `Classification` | Rules first; ONNX fallback; LLM only phrases (I5) |
| story | classification + tx → `Story` | Template slots filled from structured data |
| tax | `NormalizedTx` + classification + prices → `TaxEvent[]` → lots → 8949 rows | Deterministic (I6) |

## Classification cascade

1. **Rules** (instant, deterministic): ABI/selector matches (EVM), program-ID + balance-diff patterns (SVM), tags (e.g. `compression:compress`).
2. **ONNX** (`mlClassifier.ts`): only for txs rules mark `unknown`; features come from `NormalizedTx`, not raw chain data, so one model spans chains
   (retrain with Solana samples in Phase 3).
3. **LLM (optional, off critical path):** produces prose from a **redacted structured summary**; output validated against a JSON schema;
   amounts/entities are substituted from structured data. Offline keyword fallback if no key.

## Deployment and secrets model

The EVM explorer and Gemini keys sit behind the server-side proxy (ADR-013); other provider keys are user-supplied. This matters more for Solana than EVM because ZK Compression reads need a
**Photon-capable provider** (e.g. Helius, Alchemy, Triton — `TODO(verify)` current provider list).

| Concern | Decision |
|---------|----------|
| RPC / Photon / Etherscan / Gemini keys | Entered in Settings, kept in `localStorage`, never logged, never in URLs shared by the app |
| Keys embedded in the bundle | Not allowed for paid keys. A domain-restricted public demo key is acceptable for a hosted demo |
| Rate limits (429) | Central throttle + backoff; UI shows which provider throttled |
| No Photon provider configured | Solana works for standard accounts; UI shows "compressed activity unavailable" (not an error) |
| Optional stateless edge proxy to hide a shared key | **Not part of the plan.** Would violate I2 in spirit; requires an ADR if ever proposed |

## Performance and UX

- Progressive rendering: stream pages into the feed; show "indexed up to slot/block N".
- Solana history is heavy (1,000 signatures/page, one `getTransaction` per signature): cap initial load (e.g. latest 500 txs), offer "load more".
- Concurrency limits per provider; cancel in-flight work when the user changes address.
- Cache immutable data aggressively (finalized txs keyed by `chain:hash`); never cache tip-of-chain results as final.

## Failure handling

| Failure | Behavior |
|---------|----------|
| Provider 429/5xx | Backoff, then partial results + banner |
| Photon behind RPC | Lag banner: "Compressed state indexed to slot X (Y slots behind); recent compressed activity may be missing" |
| Price missing | Story still renders; tax marks row `price_missing` and excludes from totals until resolved |
| Unknown program / selector | Generic story, `confidence: low`, tag `unknown_program` (I8) |
| Schema validation fails | Drop that tx into an "unparsed" list with reason; feed continues |

## Extension points

Add a chain → new adapter + registry entries (playbook in `08`). Add a protocol → decoder + registry entry + fixture.
Add a story category → `domain` enum + template + tax mapping decision (taxable / income / non-taxable) in one change.


## Tripwire operator persistence (ADR-015)

The operator under `scripts/tripwire/` uses a local SQLite store for atomic
feed checkpoints, pending release work and a signed transaction outbox. The
browser and stateless proxy runtimes do not import or access it. One process
owns a deployment-bound state file; recovery reuses original signed transaction
bytes and reconciles terminal vault states. HOLD/delay work remains queued.
See the [operator runbook](plans/tripwire-operator.md) for scope, recovery and
the outstanding finality/source-verification boundaries.


ADR-016 adds hash-bound finalized RPC checkpoints and a signed/included/finalized
transaction lifecycle. The operator checks anchors before recovery and publication;
only finalized terminal vault state completes a job. An unfinalized receipt reorg
reuses its original signed bytes, while a finalized-history conflict persists a
quarantine. This is provider-trusting Ethereum/Sepolia policy, not a consensus
light client or a substitute for independent bridge-message authentication.

ADR-017 adds the CCTP v2 USDC post-mint source adapter. Pure EVM codecs/verified
protocol facts live in `src/chains/evm/`; receipts, proof claims, signing guards and
the read-only audit CLI remain in `scripts/tripwire/`. Durable source and settlement
identities/nonce claims bind a finalized burn to the exact escrow payout. The
operator factory is explicit; no CCTP signing/relaying enters the browser or proxies.
See the [CCTP runbook](plans/tripwire-cctp.md) for policy and remaining trust boundaries.

ADR-019 adds protection refresh inside the existing operator tick. Guardian
tier/expiry/oracle and chain time are read from one hash-checked latest state
block, bounded below by observed write receipts. Source evidence stays finalized.
Fresh pending assessments may renew a matching active tier near expiry; stale
decisions are not persisted as permanent risk flags. Existing queue/outbox recovery
and quarantine apply to refresh signatures and transactions as well.

ADR-020 scopes guardian callers by route, uses a bounded conservative rolling
budget and adds a sticky per-message delay to ProtectedVault/CctpEscrow. The
operator binds request delay to chain time and waits without repeated ALLOW
signatures, while reassessing risk/source health/protection. Immutable policy-v2
markers and route grants are checked before opening the signing lifecycle;
release review domain version is 2. Existing deployment-bound persistence and
read-only browser boundaries remain. See [policy/rollout](plans/tripwire-route-policy.md).
