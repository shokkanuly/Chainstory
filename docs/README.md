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
The sixth adds continuous refresh of freshly justified pending risk before the
guardian's 24-hour expiry, with chain-state reconciliation and the existing outbox.
The seventh scopes reporter permissions to routes, removes fixed-window boundary
bursts and gives large delayed requests individual clocks. This immutable policy
v2 needs a fresh reviewed deployment; [limits and rollout](plans/tripwire-route-policy.md).
The eighth closes the settlement-firewall brief's remaining gaps: the guardian and
vault accept a k-of-n `TripwireQuorum` as their oracle (policy v3; its members still
run in one process), source proofs are read through independent RPC providers that
must agree, and one proof-first verdict with named checks and a tighten-only route
policy decides every release ([build map](plans/tripwire-settlement-firewall.md), ADR-021–023).
The ninth remediates the October audit (policy v4, ADR-024–027): oracle replacement
takes two days and a kill switch is instant, the oracle alone holds a route at most
72 hours, DELAY counts split payouts, a REJECT is a 7-day hold rather than stranded
funds, keys are split by role with separate nonce lanes and fee-bumped replacement,
and the live operator computes a rolling baseline.

The eighth adds a keyless CCTP observer and unsigned deployment planner for the
selected Base Sepolia → Ethereum Sepolia pilot. Separate local role wallets are
prepared; public deployment and real transfers remain pending. See the
[pilot runbook](plans/tripwire-pilot.md).
The ninth milestone validates scorer inputs and screening snapshots: unavailable
or malformed inputs cannot clear, and watcher retries recover after a screening
outage. The [v1 product contract and P0 backlog](plans/tripwire-product.md) now
define customer policy, funded recovery and source bypass boundaries; live
acceptance remains pending. A [partner interview and pilot kit](plans/tripwire-partners.md)
is prepared; no outreach or partnership is claimed.
The next local milestone adds [customer policy and destination recovery](plans/tripwire-payment-policy.md)
in `CctpPaymentEscrow`, with review format 3. Legacy signing profiles refuse it.
The new local command demonstrates approval, delay, return and exact credit accounting;
The [product operator integration](plans/tripwire-payment-operator.md) now verifies
new receipt/operation bindings, reads coherent policies, signs format-3 reviews and
reconciles customer returns through the existing durable outbox. Manifest v3 and
unsigned product deployment encoding are available. [Exact runtime acceptance and
keyless preflight](plans/tripwire-testnet-readiness.md) now cover product startup,
observer polls and unsigned preparation. [Receipt-backed initial deployment
acceptance](plans/tripwire-deployment-acceptance.md) now verifies the prepared
package's actual transactions, initial policy/storage and complete sole-grant
history. The [first-payment planner](plans/tripwire-first-payment.md) adds current
Standard fee checks, bounded approval/reset and one simulated unsigned action,
with a reserved burn nonce; 950 tests pass locally. Its actual public run is blocked
by four missing deployment transactions. A live read-only
snapshot shows missing testnet gas/source USDC; a fresh unsigned v3 package is prepared.
Fresh public deployment, real receipts, behavioral shadow separation and audit
remain pending.
For the next developer, start with the [handoff and implementation queue](plans/tripwire-handoff.md):
clean-clone setup, current limits, pending live gates and checkable next steps.
Read the [current continuation checkpoint](plans/tripwire-progress.md) for the
latest completed step and exact next gate. H2a adds classified observer startup
and process exits; H2b1 now classifies running failures and stops on journal faults.
H2b2 now adds a foreground supervisor, actual subprocess recovery drills and local
incident records; installation and acceptance in the team's live environment remain
pending. See the [supervision runbook](plans/tripwire-operations.md#bounded-observer-supervision-and-local-incidents-adr-042).
H4a adds the [mandatory/behavioral matrix](plans/tripwire-decision-matrix.md) and
a pure read-only signal model. Current payment enforcement remains unchanged;
H4b adds [optional advisory reports/display](plans/tripwire-operations.md#behavioral-advisory-reports-and-viewer-adr-044)
with honest keyless-observer unavailability. Reviewed shadow-only execution remains pending.

H4c1 records [the proposed customer advisory/screening policy](plans/tripwire-behavioral-policy.md), ADR-045:
independent issuer evidence, explicit customer consent and coordinated new-version
migration. This is a design only; execution still uses legacy enforcement.
The H4c2 pure read-only evidence verifier is now implemented (`src/chains/evm/screening.ts`);
it never returns ALLOW. H4c3a adds the on-chain half: `CctpScreenedPaymentEscrow`
verifies the issuer's receipt at review and again at execution (ADR-047). Next is
H4c3b, the operator integration.

On 2026-10-09 the payment track was merged into `main` on top of guardian policy v4
(ADR-046); its ADRs are now numbered 028–045. The handoff and checkpoint are in
English, an [audit package](plans/tripwire-audit-package.md) is ready for a reviewer,
and `scripts/smoke/` holds real-browser checks of every route and of the report-folder flow.

The [operations viewer](plans/tripwire-operations.md) at `/tripwire/operations`
now displays public funding/customer observer snapshots, reasons and receipt
anchors with explicit stale/error states. Receipt-backed lifecycle milestones now
separate settlement and escrow block-time durations. Bounded one-shot operation
discovery adds automatic locators and explicit coverage/gaps. Durable hint journals
now resume searches, retain conflicts and process finalized backlog in bounded
increments while rechecking receipts. Continuous keyless observation now adds
sequential polling, capped RPC retry delays, terminal stops and atomic public
files with capture-time worker health. Read-only local-folder refresh is now
implemented with continuity/failure guards; native folder selection end-to-end
remains unverified by automation. Optional bounded archival now preserves older public reports outside the viewer
top level, with crash/collision guards and unchanged discovery claims. 1,294 tests
pass locally. Imports do not
authenticate or authorize payments.
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
