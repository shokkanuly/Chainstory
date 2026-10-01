# ChainStory Documentation

**ChainStory v2: multi-chain wallet narrative engine with Solana and ZK-compressed state support.**

## Document map

| Doc | Purpose | Audience |
|-----|---------|----------|
| [01-vision-and-scope](./01-vision-and-scope.md) | Problem, users, scope, and corrections to the original planning notes | Everyone |
| [02-architecture](./02-architecture.md) | Layers, folder layout, adapter contract, pipeline, deployment model | Engineers, AI |
| [03-domain-model](./03-domain-model.md) | Shared types (`NormalizedTx`, `Story`, `TaxEvent`) and mapping rules | Engineers, AI |
| [04-solana-and-zk-compression](./04-solana-and-zk-compression.md) | How Solana + ZK Compression are read, decoded, and (optionally) written | Engineers, AI |
| [05-roadmap](./05-roadmap.md) | Phases with goals, steps, dependencies, and checkable "done when" | Everyone |
| [06-quality-security-privacy](./06-quality-security-privacy.md) | Testing, fixtures, privacy claims, LLM safety, wording policy | Engineers, AI |
| [07-decisions-adr](./07-decisions-adr.md) | Why things are the way they are | Everyone |
| [08-ai-playbooks](./08-ai-playbooks.md) | Step-by-step recipes for recurring tasks | AI |
| [09-glossary](./09-glossary.md) | Terms (Solana, ZK Compression, tax) | Everyone |

AI agents: start at [`../AGENTS.md`](../AGENTS.md).

## How the two original projects connect

The original notes described two things that look like one project but are different **layers**:

- **ChainStory** = *read and interpret* (off-chain analytics, client-side).
- **ZK Compression build plan** = *store and verify* (on-chain program + proof pipeline).

They connect at three points, in this priority order:

1. **Read path (core value, Phases 1–2).** ChainStory's Solana adapter reads compressed state through the Photon indexer
   and explains it. This needs **no custom on-chain program**.
2. **Test path (Phase 2).** Scripts create compressed accounts on devnet/local validator; the recorded transactions become
   ground-truth fixtures for the decoder.
3. **Write path (Phase 5, optional, gated).** A small program (`story-attest`) stores opt-in "story receipts" as compressed
   accounts. It is read back by the *same* read path as any other compressed state.

```
                         ┌────────────────────── ChainStory v2 (browser) ──────────────────────┐
 address / name ─► Chain Router ─┬─► EVM adapter ───────────┐
                                 └─► Solana adapter ────────┤   standard txs + Photon compressed state
                                       ▲                    ▼
                                       │            NormalizedTx[]   (src/domain, chain-agnostic)
                                       │      ┌─────────┬──────┴──────┬───────────┐
                                       │      ▼         ▼             ▼           ▼
                                       │  Classifier  Pricing       Risk      Guard (Phase 4)
                                       │      │         │             │       simulate-before-sign
                                       │      └──► Story feed    Tax engine (FIFO) ─► CSV / PDF
                                       │
 programs/story-attest  (Phase 5) ─────┘  writes compressed PDAs ──► read back by Solana adapter
 scripts/fixtures/zk    (Phase 2) ──────► creates compressed txs on devnet ──► fixtures/tests
```

## Status board (keep in sync with 05-roadmap)

**Active work: Tripwire hardening.** The first milestone adds a signed per-release
execution gate and retryable observations. The second adds durable operator state,
signed transaction recovery and HOLD/delay retries. The third adds finalized
RPC observations, receipt reorg recovery and durable quarantine
([runbook](plans/tripwire-operator.md)).
The fourth adds a [CCTP v2 USDC post-mint escrow adapter](plans/tripwire-cctp.md),
durable source/settlement/nonce claims and a read-only receipt audit command.
The fifth adds self-owned `CctpEscrow`: an authenticated Circle mint and immutable
PENDING request are atomic; the operator verifies both in the settlement receipt.
External review, fresh deployment and the live transfer pilot remain pending.
See [the plan](plans/tripwire-hardening.md)
for implemented behavior, remaining P0 work and the old Sepolia deployment boundary.
The wallet/Solana phase table below describes the earlier project work.

| Phase | Name | Status |
|-------|------|--------|
| 0 | Foundation: chain-agnostic seams + characterization tests | ☑ completed |
| 1 | Solana thin slice (standard accounts) | ☑ completed |
| 2 | ZK Compression read support | ☑ completed |
| 3 | Solana intelligence: Jito/MEV, risk, cross-chain portfolio | ☑ completed |
| 4 | Guard: pre-sign transaction simulation | ☑ completed |
| 5 | `story-attest` compressed receipts (experimental, gated) | ☑ completed |

## Documentation rules

1. One fact lives in one doc; other docs link to it.
2. A change to a contract (types, adapter interface, invariants) updates docs **in the same change**.
3. Anything unverified is marked `TODO(verify)` with the source to check. Never state guesses as facts.
4. Decisions with trade-offs go in the ADR log, not in chat history.
