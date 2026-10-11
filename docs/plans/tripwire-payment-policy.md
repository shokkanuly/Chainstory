# Customer payment policy and funded recovery (ADR-028)

Contract implemented locally 2026-10-05; operator integration added 2026-10-06.
`CctpPaymentEscrow` is the next immutable
escrow implementation; it has not been deployed or independently audited.
Its local fixture uses a synthetic attester and token, not real CCTP receipts
or Circle's threshold cryptography.

H4c1 records [the proposed customer advisory/screening policy](tripwire-behavioral-policy.md), ADR-045:
independent issuer evidence, explicit customer consent and coordinated new-version
migration. This is a design only; execution still uses legacy enforcement.
The next H4c2 step implements pure read-only evidence verification, not ALLOW.

## Run the workflow

`npm run tripwire:payment:demo:local`

Real compiled bytecode executes in a local EVM with throwaway actors. The command
sends no public transaction and reads no user key. It demonstrates ordinary payout,
customer approval and delay for a larger payment, exact recovery for an unpermitted
beneficiary, stale ALLOW rejection and base-unit credit accounting.

## Immutable customer configuration

Retain the inherited token/guardian/route and Circle source/destination bindings.
Also configure a policy authority, authorized source sender, destination recovery
recipient and recovery delay (1 hour to 30 days). Source sender means the attested
burn body's messageSender, not the TokenMessenger or an unauthenticated RPC log.

Authority must be nonzero and distinct from the initial oracle. It may be a customer
smart account; the contract adds no multisig and cannot prove who controls an
address. Confirm authority/recovery control during deployment acceptance. Changing
these immutable bindings requires fresh deployment and credit reconciliation.

Source-account binding prevents unrelated depositors occupying operation IDs.
It does not constrain that account's other destinations/routes. Source permission
and bypass review remain necessary for an entire-flow treasury guarantee.

## Authenticated application intent

Circle header/burn validation is inherited from `CctpEscrow`. The new Tripwire
hook is an application convention, not a Circle-standard executable hook:

| Word | Meaning |
| :--- | :--- |
| 0 | `keccak256("Tripwire/CCTP/v2/USDC/payment/v1")` |
| 1 | Canonically padded payout beneficiary |
| 2 | Canonically padded recovery beneficiary, equal to immutable customer configuration |
| 3 | Nonzero business operation ID |
| 4 | Nonzero source-intent customer policy hash |

Accept exactly 536 message bytes: inherited 376-byte header/body plus 160-byte
hook. Reject legacy hooks, extra words, invalid addresses and missing commitments.
Require authenticated messageSender to equal authorized source sender. Each
operation ID can fund one credit, separately from the CCTP nonce guard.

A burn may settle after policy changes. Mint still creates its original immutable
credit; an old intent hash then requires fresh customer approval before payout.
Unsupported/reused messages revert without mint/credit. A source burn unable to
settle needs a separate CCTP operational procedure; no credit exists to return.

Release identity uses `Tripwire/CCTP/v2/payment-escrow/v1`, destination chain/vault,
source domain and attested nonce. It differs from legacy IDs. `PaymentCreditBound`
records operation/recovery/intent commitments; `CctpEscrowFunded` records net mint
and full message hash. Source operation IDs need a customer namespace.

## Execution constraints

Initial policy: maximum payment, manual approval above a threshold, delay above
a threshold, delay duration (at most 30 days), up to 100 distinct permitted
recipients. Thresholds use strict `>`; zero threshold applies to every positive
payment. Zero delay adds no time. Amounts are uint256 token base units; no USD
heuristic determines credit, return or these hard constraints.

The existing signer/TTL/nonce/guardian-tier/rolling-budget/guardian-delay gates
remain mandatory. Execution additionally requires no return intent, current
review policy version, no customer pause, permitted beneficiary, current maximum,
current-version customer approval above the threshold or for an old source intent,
and a matured customer delay. Customer approval cannot override other constraints.

Same-version review retries/HOLD→ALLOW never shorten or restart a clock. First
ALLOW under another version can add delay; retain the maximum of old/new deadlines.
Every applied customer change invalidates existing reviews and approvals; even
unrelated changes make older source intents require customer reapproval. This is
deliberately conservative. Guardian budgets retain ADR-020's separate owner powers;
they are not mutable fields of this customer policy.

## Queued changes and signed reviews

Only the policy authority schedules policy, recipient grants or unpause. Changes
mature after one day; anyone can relay exact queued arguments. One pending change
exists. Replacement emits cancellation and a new queue event. Emergency pause
and recipient revocation take effect immediately, increment version and cancel
the queue. These powers can deny payments, not redirect credit destinations.

Initial policy hash binds chain, vault, token, guardian, route and customer config.
Each commit hashes prior hash, new version and canonically ABI-encoded action:
an ordered action-history commitment, not UI prose or ambiguous JSON.

New marker: `REVIEW_FORMAT_VERSION() = 3`, `PAYMENT_ESCROW_VERSION() = 1`.
The shared release policy remains 2. New EIP-712 primary type:

`PaymentReleaseReview(bytes32 releaseHash,uint256 policyVersion,bytes32 policyHash)`

`releaseHash` is the original ReleaseReview struct hash, binding all original
payment/decision/tier/expiry/nonce fields. Outer domain retains
`TripwireProtectedVault`, version `2`, destination chain and vault. The distinct
type and policy commitments make old signatures invalid. Never infer review
signing semantics from `RELEASE_POLICY_VERSION` alone.

Legacy demo/operator/CCTP profiles require review format 2 and refuse the
new implementation before opening state/signing. The explicit manifest-v3 product
profile now uses `signPaymentReleaseReview`, checked policy/credit snapshots and
the existing durable outbox; [integration/runbook](tripwire-payment-operator.md).

## Return state and accounting

Only the configured recovery recipient can request return. The source hook must
name that exact address; allowing arbitrary sender-selected return addresses would
bypass recipient permissions. Requesting return immediately blocks reviews,
customer approval and payout. It cannot be cancelled, shortened or redirected.
Executed credits cannot enter return; held and payout-rejected funded credits can.

At the fixed deadline anyone may relay full net return to the recorded address.
It works during customer pause/guardian FREEZE without consuming the business
payout budget: explicit customer recall to its precommitted treasury, not an
administrator sweep. It does not undo the source burn or automatically bridge back.

Mark returned, terminally reject original payout and update totals before transfer.
A token revert rolls these effects back, keeping return retryable. Receive, payout
and return share one reentrancy guard. Failed payout also rolls back state/totals/
guardian spend. Paid and returned are mutually exclusive full-credit outcomes.

`totalCredited = totalPaid + totalReturned + outstandingCredit()`.
Donations increase token balance but create no accounting credit/request. A return
cannot spend donations or another credit. No partial-return/arbitrary-withdraw API
exists. Burned-but-unminted funds are outside these totals and must be counted in
pilot exposure separately. Recovery cannot override token restrictions or loss of
the recovery account; customer key custody and recovery control need review.

## Integration status and remaining acceptance gate

Manifest v3, unsigned product deployment encoding, finalized payment receipt
verification, disjoint durable profile, coherent policy snapshots, new review
signatures and return/outcome recovery are implemented locally under ADR-029.
The observer reports policy blockers and distinguishes returned credits. Existing
legacy profiles remain explicit; there is no fallback or automatic credit/outbox
migration. See the [operator runbook](tripwire-payment-operator.md) for commands,
trust boundaries and the 68 new synthetic integration cases.

Before the public pilot: verify actual deployed bytecode/configuration and source
permissions, collect real CCTP source/settlement receipts, validate behavioral data
or implement the specified shadow separation, run live recovery drills, add customer
read-only operation views and complete independent review of the release artifacts.

Shared legacy artifacts were regenerated to expose the review-format marker and
the extension hooks. Old unsigned deployment packages do not describe the current
artifact hashes; regenerate/review them before using them. No existing package,
wallet, journal, credit or public deployment has been automatically migrated.

No live accuracy, latency, adoption or prevented losses are claimed.

## Local validation

Contract milestone validation: 744 tests passed, 61 added by that
slice (47 payment-contract cases, 10 codec vectors, artifact and startup cases).
`npm run build`, `npm run lint`, the existing local demo and the new payment demo
passed. Fresh payment runtime is 15,913 bytes, below EIP-170's 24,576-byte limit;
artifact consistency tests exclude both test-only harnesses from release artifacts.

Mutation checks cover 54 cases, including 16 new payment/recovery guards. The
full run caught 53; one existing finality mutation had an obsolete source pattern
after refactoring the common receive function. Its pattern was corrected and
`npm run test:mutants -- 'CCTP finality'` caught the remaining case. A name substring
now allows targeted reruns; matching no cases fails. The runner restores all
sources/artifacts, including the new payment implementation, on exit.

Regression-first tests also exposed arbitrary source-selected refund destinations
and unrelated depositors reserving operation IDs. The new immutable recovery/source
bindings close those cases. These local checks are not a substitute for review
of actual deployed artifacts, source permissions and live recovery evidence.
