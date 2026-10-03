# Tripwire as a settlement firewall — positioning and build map

Written 2026-10-01. This consolidates the `codex/tripwire-*` hardening stack
(release reviews → durable operator → finality → CCTP → protection refresh →
route limits) and adds the three missing pieces the product brief names:
threshold attestation (ADR-021), independent multi-RPC verification (ADR-022)
and one auditable proof-first decision (ADR-023).

## North star

> No cross-chain asset should be minted or released unless an independent system
> can prove that the corresponding economic event actually happened.

Cross-chain systems can authenticate a *message* and still allow an
economically invalid *outcome*: the destination releases or mints although the
source event is missing, mismatched, not final, or outside safe limits.
Tripwire makes the proof part of execution, not an alert after the damage.

```
SOURCE              MESSAGE            TRIPWIRE                     VERDICT              SETTLE
burn / lock /  →   bridge / relayer  →  verify source state     →   ALLOW / THROTTLE  →  mint /
deposit                                 + invariants + policy       DELAY / FREEZE       release
```

Product position: a small, embeddable safety primitive placed directly in front
of settlement — not another security dashboard.

## The six build-focus items, and where each lives

| # | Brief | Implementation | Status |
| :- | :--- | :--- | :--- |
| 1 | **Real pre-execution hook** — the bridge must ask before settlement | `ProtectedVault.executeRelease` requires a fresh, payout-bound ALLOW review and calls `guardian.onTokenOutflow` before transferring; `CctpEscrow` creates requests only from an authenticated Circle mint (ADR-014, ADR-018) | Implemented locally |
| 2 | **Deterministic invariant engine** — proof first, heuristics supporting | `scripts/tripwire/settlement.ts`: `settlementVerdict` returns ALLOW/HOLD/REJECT, the route tier and every named check. Proof checks (source authenticated + final, backing covers payout) decide REJECT; safety checks only HOLD (ADR-023) | **Added in this change** |
| 3 | **Independent verification** — multiple RPC paths, finality, no blind trust | Finalized observations and reorg quarantine (ADR-016); `scripts/tripwire/rpcQuorum.ts` reads every source proof through independently operated providers: a quorum must answer and all must agree, one dissent holds (ADR-022) | **Quorum added in this change**; finality implemented locally |
| 4 | **Programmable policy** — per-route size, velocity, finality, settlement rules | On-chain: route-scoped reporters, conservative rolling cap (velocity), per-request DELAY (ADR-020). Off-chain: `RoutePolicy` — `maxSingleRelease`, `holdAtScore` — can only tighten (ADR-023). Finality is fixed to `finalized` + Circle Standard for CCTP | Rolling/delay implemented locally; **per-route size/hold policy added** |
| 5 | **Safe enforcement** — ALLOW, THROTTLE, DELAY, FREEZE, scoped to the route | Guardian tiers are per route, escalate-only, expire in 24 h, and never move funds; FREEZE stops every outflow on that route only | Implemented; refresh before expiry (ADR-019) |
| 6 | **Strong trust model** — from one signer toward threshold attestations | `contracts/evm/src/TripwireQuorum.sol`: self-governing k-of-n ERC-1271 oracle with an honest-majority rule; guardian and vault accept it with no other rule changed. `scripts/tripwire/quorum.ts`: each member signs only what its own verification supports (ADR-021) | **Added in this change** |

## Decision flow for one release

1. **Observe** the release request and its source event on finalized blocks
   (`watch.ts`, `events.ts`).
2. **Verify the source** through the bridge adapter (`cctp.ts`), reading every
   receipt and header through the RPC quorum (`rpcQuorum.ts`). Result:
   VERIFIED, PENDING, UNAVAILABLE or INVALID.
3. **Score** the release with the behavioral oracle (`src/tripwire/riskScorer.ts`)
   — supporting evidence only.
4. **Decide** with `settlementVerdict`:
   - any proof check fails → **REJECT** and recommend **FREEZE** for the route;
   - any proof check unknown → **HOLD**;
   - any safety check fails or is unknown → **HOLD**;
   - otherwise → **ALLOW**.
5. **Enforce**: the attestor escalates the route tier through the guardian; a
   quorum signs the per-release review; the vault executes only a fresh quorum
   ALLOW that meets the tier, rolling cap and request delay.

## What changed in this milestone

- `TripwireQuorum.sol` (new), ERC-1271 oracle path in `TripwireGuardian.sol`
  and `ProtectedVault`; policy markers 2 → 3, enforced by
  `testnet/protectionPolicy.ts`.
- `scripts/tripwire/quorum.ts`: `quorumAccount`, `localMember`,
  `collectQuorumSignature`, `combineQuorumSignatures`, `updateSignersRequest`.
- `scripts/tripwire/rpcQuorum.ts`, wired into `createCctpRpcOperator`
  (`verifiers` option) and `tripwire:cctp:verify`
  (`*_VERIFIER_RPC_URLS`, `TRIPWIRE_RPC_QUORUM`).
- `scripts/tripwire/settlement.ts`; `review.releaseDecision` delegates to it;
  the watcher attaches `policy` to observations; operator results carry the
  deciding `reason`.
- Tests: 25 quorum EVM cases, 13 RPC-quorum cases (including a lying provider
  that fabricates a CCTP mint: verified through one RPC, held through two),
  14 settlement cases including an 800-case equivalence grid against the rule
  it replaced. Ten new contract mutants.

## Still open, in priority order

| Priority | Work | Acceptance |
| :--- | :--- | :--- |
| P0 | External review of guardian, vault, escrow and quorum | Findings resolved or accepted in an ADR |
| P0 | Fresh policy-v4 deployment with separate keys and an owner Safe on testnet ([runbook](tripwire-operator.md#redeploy-policy-v4-to-sepolia)) | Verified sources; operator refuses v3; Safe accepts ownership; a 2-day oracle rotation exercised on-chain |
| P1 | Networked attestor members | Each member runs its own watcher and RPC set, on separate infrastructure, and signs over a transport; no co-located keys |
| P1 | Quorum over `eth_getLogs` discovery, not only proofs | Event feeds read through the same agreement rule |
| P1 | Evidence versions and measured baselines | Rolling baselines exist (ADR-027); still to do: reproducible scoring versions, measured false holds and latency on a real route |
| P2 | Consensus light-client finality instead of RPC `finalized` | Proofs checked against sync-committee signatures |
| Pilot | Observe-only run on one real route | Honest traffic and attack fixtures quantify detection, false holds and added latency |
