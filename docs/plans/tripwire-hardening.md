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
6. Record confirmed outcomes before acknowledging an observation. Keep a separate
   durable retry/review queue for held, delayed and expired requests.

An ALLOW review is an additional operator gate, not a cryptographic source proof.
The reviewer can allow an existing request; it cannot create one, modify payout
fields or bypass the guardian. A compromised reviewer can nevertheless approve
an invalid pending request if the bridge itself failed to authenticate it.
Independent bridge authentication is mandatory for a production integration.

## Deployment status

This milestone is local and reviewable. No live contracts have been redeployed.
The existing Sepolia addresses describe the earlier demo, whose vault has no
release-review gate. The latest scripts require a fresh deployment. The browser
incident replay still demonstrates the guardian's route restrictions; it does
not run the new per-release vault gate.

Both demos still use synthetic source evidence. MockSourceBridge emits an event
and does not actually burn tokens. No real bridge adapter, two-network finality
verification or continuous production operator is claimed here.

## Remaining milestones, in dependency order

| Priority | Work | Acceptance condition |
| :--- | :--- | :--- |
| P0 | Durable event, cursor, pending-request and submission store | Crash at each transaction boundary loses no observation; restart retries signed/submitted transactions safely |
| P0 | Adapter for one selected bridge and one asset | Wrong chain/contract/token/recipient/amount and reused source messages are rejected; missing data is held |
| P0 | Finality and reorg reconciliation | Reverted source evidence invalidates affected pending reviews; database state and cursors follow canonical block hashes |
| P1 | Continuous attestor with protection refresh | Persistent risk does not silently lose route protection at the 24-hour boundary; restart reconciles current on-chain state |
| P1 | Guardian route isolation, rolling limits and per-request delay policy | Boundary bursts and cross-route callers are covered by adversarial tests; delayed requests have a documented retry/review policy |
| P1 | Real route baselines and evidence versions | Reproducible historical scoring, cold-start/staleness policy and measured false holds/latency |
| P1 | Separate owner/oracle roles and reliable transaction sender | Rotation, insufficient gas balance, nonce conflicts, dropped transactions and RPC outages are observable and recoverable |
| P2 | Incident review dashboard | Operators see source evidence, data health, decision version, actual guardian state and confirmed review/payout receipts |
| Pilot | Observe one real route before enforcing small limits | Honest traffic and attack/failure fixtures quantify detection, false holds and additional latency |

Operator persistence belongs outside the read-only browser app and existing
stateless API proxies. Its design will be recorded in a separate ADR. No new
dependencies are introduced by this first milestone.
