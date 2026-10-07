# Tripwire hardening — first milestone and remaining work

Authorized in the project chat on 2026-09-30. Current focus is Tripwire; Retold
feature work is outside this plan. Shared contract-fact services remain reusable.

## First milestone: review-gated payouts and retryable observations

The original 303 tests passed before changes. Five new regressions then failed:
an attacker could execute a requested payout before the watcher ran; a missing
source event became a proven attack; a late source event was never reconsidered;
an explorer failure lost a polled release; and an RPC failure advanced the log
cursor past events that had not been processed.

Implemented:

- `ProtectedVault` creates PENDING requests. Execution requires a fresh oracle-signed
  ALLOW review; HOLD and REJECT cannot execute. REJECT is terminal even after route
  protection expires or the owner calls `resume`.
- Reviews bind message ID, route, token, recipient, exact amount, decision, minimum
  guardian tier, expiry and a monotonically increasing per-message nonce. The EIP-712
  domain binds the vault and destination chain. An old ALLOW cannot overwrite a newer
  HOLD, and rotating the oracle invalidates previously granted execution allowances.
- A review cannot outlive ten minutes. A delayed payout may need a new review before
  retrying. Execution still passes through the guardian and uses SafeERC20.
- Watcher source evidence is VERIFIED, PENDING, UNAVAILABLE or INVALID. No verifier
  configured means PENDING, including when an event has been observed. Malformed
  verifier responses are UNAVAILABLE. Missing and conflicting observations alone
  cannot establish a proven attack.
- Backing comparison uses exact bigint base units and an explicit basis-point
  tolerance. USD floats remain only in the existing illustrative behavioral scorer
  and legacy incident reconstruction; they are not the new backing verification path.
- Polls are serialized. Recipient lookup failures are isolated. Requests remain
  available for retry until explicitly acknowledged; repeated source notifications
  do not multiply backing. Event cursors advance only after all timestamps and
  event validation succeed.
- Local demo deploys the actual token, guardian and gated vault in one local EVM.
  Signed reviews are submitted before payout. Sepolia scripts refuse an old vault
  before sending reset or payout transactions.

Validation: `npm test`, `npm run build`, `npm run lint`, `npm run test:mutants`,
and `npm run tripwire:demo:local`. Mutation testing covers the existing guardian
tiers and seven release-review properties. No public-chain transaction is required
for these checks.

## Integration contract

1. Independently authenticate the bridge message and its source backing.
2. Feed validated, finality-aware observations to the watcher. The source verifier
   must verify the configured source contract, chain, asset mapping, recipient,
   message uniqueness and supported fee semantics. Its `verified.amount` must refer
   to this release, not an unrelated burn with the same dollar value.
3. Score the release; submit and confirm any required route escalation.
4. Read the release's current nonce. Sign the next review with its required minimum
   tier and short expiry. Submit and confirm that review before attempting execution.
5. Execute through the gated payout contract. A revert is not a successful payment.
6. Acknowledge only matching on-chain EXECUTED or REJECTED outcomes. Keep held,
   delayed and expired requests in the durable queue for reassessment.

An ALLOW review is an additional operator gate, not a cryptographic source proof.
The reviewer can allow an existing request; it cannot create one, modify payout
fields or bypass the guardian. A compromised reviewer can nevertheless approve
an invalid pending request if the bridge itself failed to authenticate it.
Independent bridge authentication is mandatory for a production integration.

## Scorer input safety — 2026-10-05

Synthetic regression fixtures first reproduced 33 failures. The scorer now takes
one screening observation for both health and the signal. Null, malformed results
and lookup exceptions mean unavailable; a label lookup failure cannot erase a
positive observation. Unavailable screening alone produces `indeterminate`/null,
not `clear`. The watcher holds that request and reassesses after recovery.

Baselines must match the transfer route and have sufficient integral samples,
finite positive history window/p95/liquidity, a nonnegative median no greater than
p95 and a fresh nonfuture computation timestamp. A usable transfer price is finite
and nonnegative. Invalid assessment/transfer timestamps, relevant recent amounts
or history timestamps and invalid scorer configuration produce indeterminate
assessments. Other-route and out-of-window amounts do not affect this decision.
Missing recent amounts are not treated as zero. Invalid legacy USD proof values
are unavailable evidence, not an independently established source mismatch.

Invalid inputs do not enter behavioral rules. A confirmed exact backing mismatch
retains its deterministic score of 1 even with unavailable behavioral inputs;
NaN statistics cannot average that evidence into a clear verdict. Invalid scorer
configuration always holds. Optional contract facts remain optional; partial
facts no longer describe an unchecked contract as verified and established.

This fixes the current scorer's safety contract. It does not implement the new
customer-policy/shadow-signal separation or funded-credit recovery in the
[product backlog](tripwire-product.md). Behavioral USD values remain approximate;
authenticated token backing and hard budgets use exact base units.

Local validation for this slice: 683 tests passed, including 44 new scorer
fixtures and two new watcher recovery/mismatch tests. Commands:
`npm test -- --maxWorkers=2 --minWorkers=1`, `npm run build`, `npm run lint`,
`npm run test:mutants` (all 38 caught), and `npm run tripwire:demo:local`
(NONE → THROTTLE → DELAY → FREEZE; real gated-vault bytecode in a local EVM).
The existing artifact-compilation test exceeded its five-second timeout while
the first full suite ran alongside a build; limiting test workers and running
that suite without the build passed. No timeout or contract-test semantics changed.
Public transactions and external review are not part of this validation.

## Deployment status

This milestone is local and reviewable. No live contracts have been redeployed.
The existing Sepolia addresses describe the earlier demo, whose vault has no
release-review gate. The latest scripts require a fresh deployment. The browser
incident replay still demonstrates the guardian's route restrictions; it does
not run the new per-release vault gate.

Both demos still use synthetic source evidence. MockSourceBridge emits an event
and does not actually burn tokens. A separate [CCTP v2 USDC escrow adapter](tripwire-cctp.md)
now authenticates source burn and destination mint receipts on two testnets. Its
fixtures are synthetic; no recorded live transfer or production deployment is claimed.
Its new `CctpEscrow` creates immutable PENDING requests only from an authenticated
Circle mint in the same transaction. The escrow owns itself; the review oracle
cannot create credits or redirect their amount/beneficiary. ADR-018 records the
contract/identity/policy change; historical generic vaults retain their older trust boundary.

## Remaining milestones, in dependency order

| Priority | Work | Acceptance condition |
| :--- | :--- | :--- |
| Done locally | Durable event/cursor/pending state and signed transaction journal | Atomic snapshot + original-byte recovery, terminal receipt reconciliation and HOLD/delay retries; [runbook](tripwire-operator.md) |
| Done locally; pilot pending | CCTP v2 Standard USDC, Base Sepolia → Ethereum Sepolia authenticated escrow | Wrong chain/contract/token/recipient/amount and reused claims reject; missing data holds; only an atomic authenticated net mint creates a pending request; external review/deployment still pending |
| Done for Ethereum/Sepolia RPC | Finalized observations, unfinalized receipt reorg recovery and durable quarantine | Hash-bound checkpoints/provenance; changed finalized history stops signing/recovery; real bridge consensus policy remains adapter work |
| Done locally; live operation pending | Continuous attestor with protection refresh | Fresh persistent pending risk refreshes the matching tier in the final hour before 24-hour expiry; restart re-reads chain state, unavailable data holds; ADR-019 |
| Done locally; review/deployment pending | Guardian route isolation, rolling limits and per-request delay policy | Scoped reporters, conservative rolling budget and sticky request delay; boundary/cross-route/retry regressions; [policy and rollout](tripwire-route-policy.md), ADR-020 |
| P1 | Real route baselines and evidence versions | Reproducible historical scoring, cold-start/staleness policy and measured false holds/latency |
| P1 | Separate owner/oracle roles and reliable transaction sender | Rotation, insufficient gas balance, nonce conflicts, dropped transactions and RPC outages are observable and recoverable |
| P2 | Incident review dashboard | Operators see source evidence, data health, decision version, actual guardian state and confirmed review/payout receipts |
| Pilot | Observe one real route before enforcing small limits | Honest traffic and attack/failure fixtures quantify detection, false holds and additional latency |

2026-10-05: the selected CCTP testnet pilot now has a continuous keyless observer,
finalized evidence/state reports and a reproducible unsigned deployment package;
[pilot runbook](tripwire-pilot.md). Separate local testnet role wallets were created.
No public transaction has been sent. Verified backing remains HOLD until a real
behavioral risk policy is configured; live accuracy/latency are not yet measured.

Finality-aware operator behavior is documented in [the runbook](tripwire-operator.md)
and ADR-016. Source/destination logs are finalized before ingestion; canonical
inclusion keeps short-lived review transactions usable, while terminal release
acknowledgement waits for finalized vault state. A finalized-history conflict
quarantines the operator; it cannot recall existing on-chain authorizations.

Operator persistence belongs outside the read-only browser app and existing
stateless API proxies. Its design is recorded in ADR-015. Node
built-in SQLite adds no npm dependency. The standalone operator is implemented
locally. The legacy demo runner still has no independent source/baseline configured;
the CCTP operator factory requires its explicit escrow deployment and source locators.
