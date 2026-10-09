# H4c1: mandatory screening and customer-authorized advisory policy

**Status: proposed design, 2026-10-07; ADR-045. Documentation only.**
The repository still executes `legacy-enforced`. No fields, signatures, contracts,
manifest versions or runtime switches below have been implemented or deployed.
This document specifies a project-owned protocol, not an existing Circle feature
or a screening vendor API. The next step is H4c2, a pure read-only evidence verifier.

## Product boundary and current behavior

The selected pilot remains Standard USDC Base Sepolia → Ethereum Sepolia through
one customer escrow, followed by Base → Ethereum only after the separate live,
source-control and audit gates. Protection covers credited payments through this
escrow; direct treasury transfers and alternative mint recipients remain outside
it. A fixed destination-chain return is not a reverse bridge or a source refund.

Current code references:

- [riskScorer](../../src/tripwire/riskScorer.ts) calls `isFlagged(transfer.to)` once.
  This is the payout recipient. The Watcher's `transfer.from` is the vault, not
  an authenticated source account. Screening has boolean/null health and a label.
- [testnet operator](../../scripts/tripwire/testnet/operator.ts) wraps the
  [local phishing list](../../src/services/preventiveScamScanner.ts). It has no
  snapshot version, capture time, expiry or authenticated provenance. Absence in
  that small demonstration list is not evidence of safety or sanctions clearance.
- [review](../../scripts/tripwire/review.ts) REJECTs invalid source/exact backing;
  indeterminate inputs, missing baseline/price/screening or high aggregate risk
  HOLD. A positive screen currently drives score 1, HOLD and guardian protection.
- [operator](../../scripts/tripwire/operator.ts) invokes the
  [attestor](../../scripts/tripwire/attest.ts) with the aggregate assessment.
  Therefore changing only `releaseDecision` would leave behavioral route freezes
  and refreshes in place. The aggregate also supplies review minimum protection.
- [payment escrow](../../contracts/evm/src/CctpPaymentEscrow.sol) commits current
  customer policy to reviews and enforces recipient, exact amount, approval,
  pause, sticky delay and return state. It has no screening or behavioral consent
  fields. [guardian](../../contracts/evm/src/TripwireGuardian.sol) independently
  enforces route budgets/protection. Browser advisory fields authorize neither.

The new profile is provisionally named `mandatory-screening-advisory-v1`.
It must be a distinct accepted deployment/manifest profile. A CLI flag, absent
baseline, report import, customer approval or this document cannot select it.

## Decision contract

In the target profile, mandatory decisions never consume `RiskAssessment.score`,
heuristic USD values or `BehavioralAdvisory`. They consume independently verified
backing, customer state and authenticated screening. Amounts remain bigint base
units. The following is the target ADVISORY_V1 decision table, not today's implementation:

| Evidence/state | Target payout outcome | Scope and remaining action |
| :--- | :--- | :--- |
| Proven invalid source or exact backing | REJECT original payout | Funded credit remains accounted for; fixed return stays available |
| Source/mint/backing absent, stale or not canonical | HOLD | No ALLOW/signature; preserve claims and original evidence |
| Malformed/contradictory global canonical evidence or journal failure | Stop/quarantine under existing failure taxonomy | No retry disguised as provider outage; no journal reset |
| Screening receipt is current, authenticated, bound and NOT_LISTED | Only the screening gate passes | Still require every other mandatory gate |
| Current authenticated MATCHED screening | HOLD that payment | No automatic screening-driven route FREEZE or source-invalid REJECT |
| UNKNOWN, missing, invalid, expired or contradictory screening | HOLD | No default false, optional provider or fail-open fallback |
| Recipient revoked, amount too large, paused, approval absent or intent policy stale | HOLD/unexecutable | Customer approval alone cannot override other gates |
| Customer/guardian sticky delay not mature, cap exhausted or route frozen | No execution | Preserve deadlines/spend; screening expiry requires fresh review |
| Return requested | No business payout | Only independently verified, mature fixed return |
| Finalized paid/returned | Terminal exact outcome | No duplicate payout, return or acknowledgement |
| Mandatory gates good; baseline/price/history/contract facts missing | Advisory mode may reach ALLOW | Missing heuristic stays unavailable; never fabricate history or score 0 |
| Mandatory gates good; size/velocity/contract indicator high | Advisory mode may reach ALLOW | Display the indicator; it does not select review tier or guardian action |

The last two rows apply only after explicit on-chain consent in the implemented,
reviewed profile. Legacy mode keeps current baseline/price/aggregate enforcement.
A screening match is a list observation, not an accusation that backing is forged
or that the beneficiary committed a crime. There is no calibrated loss estimate.

### Guardian and recovery independence

In target advisory mode, the authorized operator does not call the aggregate
attestor, derive minimum tier from heuristic scores, or refresh a protection
attestation because of size/velocity/contract/screen signals. Reviews use
`minimumTier = NONE`; existing guardian execution checks still enforce the active
tier, cap and sticky delay. NONE is not a resume transaction or a cap reset.
Emergency protection is an explicitly separate owner/oracle procedure with its
own reason and evidence, not a hidden scorer path.

A new deployment uses an isolated guardian/route with one reviewed producer
configuration. Mixing a legacy aggregate attestor with this producer defeats the
operational separation and must refuse startup. **Guardian policy 2 still trusts
its owner and oracle:** an oracle can deny service by tightening a tier, and the
owner can change budgets, oracle or resume. Vault consent cannot cryptographically
remove those powers. This design does not claim protection against a malicious
oracle's freeze; doing so requires a separately designed guardian version.

Screening cannot redirect funds, bypass approval, request recovery or block the
contract's existing fixed return. The return path remains customer-requested,
immutable-recipient and time-gated, with operator source/finality verification.
It does not wait indefinitely for an external screening provider. Screening of
sourceSender/returnRecipient is outside this initial payout-recipient profile;
source identity is still authenticated separately. Expanded screening coverage
requires a new explicit policy/version and recovery design.

## Screening trust and policy fields

A provider adapter must supply receipts signed by a separately approved EOA
screening issuer. The contract pins an issuer-signed active list head and verifies
issuer evidence for ALLOW and execution. A reviewer-created digest alone is
insufficient: a compromised reviewer could otherwise invent a NOT_LISTED result.
No provider is selected here; whether a real provider can supply the chosen
attestation interface is an integration gate. An intermediary issuer remains
trusted for faithful conversion of upstream data and must document that role.

Separate issuer from current review/guardian oracle and customer authority.
Enforce this at configuration and use; an oracle rotation into the issuer address
makes screening unusable until resolved. This does not prove organizational
independence or that the provider's list is true, exhaustive or legally sufficient.
The chain cannot discover a list update that the issuer never publishes.

Proposed `ScreeningProfile` version 1:

| Field | Exact representation/meaning |
| :--- | :--- |
| `version` | Literal 1; closed schema, no unknown fields |
| `providerIdHash`, `listIdHash` | Nonzero bytes32 digests of approved identifiers; separate bounded local display names |
| `issuer` | Nonzero EVM EOA; recoverable canonical signatures only in this version |
| `subject` | Literal `payout-recipient`; no silent switch to source/vault/return |
| `maxObservationAgeSeconds` | uint32, 30..600 inclusive |
| `maxSnapshotAgeSeconds` | uint32, 30..86400 inclusive; at least observation age |

For initial synthetic fixtures use 300-second observation and 3600-second snapshot
limits. These are proposed test parameters, not a measured production risk budget.
Live customer acceptance must pin limits and understand the maximum exposure to
unpublished updates. Expiry and outage reduce availability deliberately.

All project hashes use Keccak of Solidity `abi.encode`, never JSON, string
concatenation or `encodePacked`. EVM normalization/hashing lives in chains/evm.
`screeningProfileHash` encodes the following ordered values/types:

```text
bytes32 keccak256("Tripwire/Screening/profile/v1"),
uint256 destinationChainId, address vault, address guardian, bytes32 routeId,
address token, bytes32 providerIdHash, bytes32 listIdHash, address issuer,
uint8 subject (0 = payout-recipient),
uint32 maxObservationAgeSeconds, uint32 maxSnapshotAgeSeconds
```

The version-1 namespace fixes schema/outcome semantics. Provider/list namespace
changes require a new profile hash; a changed upstream semantics cannot be relabelled
as another ordinary snapshot revision. Zero/unknown identity is unavailable.

### Active list head

Proposed issuer-signed EIP-712 primary type:

```text
ScreeningHead(bytes32 profileHash,uint64 revision,bytes32 snapshotDigest,uint64 listAsOf,uint64 validUntil)
```

Both head and receipt use proposed domain `name: TripwireScreening`, `version: 1`,
`chainId: destinationChainId`, `verifyingContract: vault`. `headHash` is the complete
EIP-712 signing digest, not merely the snapshot digest. All digests are nonzero.
`revision` is positive and strictly increases within one profile. `listAsOf` is
original upstream snapshot time, never local polling/import/re-signing time.
`validUntil >= listAsOf` and `validUntil <= listAsOf + maxSnapshotAgeSeconds`.

Anyone may relay an authenticated head; only the approved issuer chooses its
contents. Target registration rejects future/expired heads at chain time, revision
rollback and a new revision with earlier listAsOf. Re-registering identical signed
head is idempotent, cannot extend its expiry. Same revision/different head is a
conflict, not replacement. Re-signing the same snapshot with later clocks must
not refresh its original listAsOf. Issuer honesty about that time remains trusted.

The contract exposes one active head hash per current profile. A later head
immediately invalidates ALLOW backed by the previous head without altering customer
policy version, spend, delay or return state. It cannot undo a finalized payout.
Missing/expired head means HOLD. Routine head publication is not a policy change;
changing provider/list/issuer/age limits is. Do not roll back to an older valid
head during outage. Restore availability with fresh evidence under the active
profile/head, not a fallback list.

### Receipt and exact payment binding

Proposed issuer-signed primary type:

```text
ScreeningReceipt(bytes32 profileHash,bytes32 headHash,bytes32 paymentContextHash,uint8 outcome,uint64 checkedAt,uint64 validUntil)
```

Outcomes: `UNKNOWN = 0`, `NOT_LISTED = 1`, `MATCHED = 2`. Unsupported values are
invalid; boolean vendor values never directly become this enum. NOT_LISTED means
no match in that identified snapshot at the stated time, not "safe".
`receiptHash` is the complete EIP-712 signing digest. Signature transport is
exactly 65 bytes, canonical low-s with v 27/28; no compact signatures or contract
wallet issuer in version 1. The verifier must recover the configured issuer.

`paymentContextHash` ABI-encodes these ordered values/types:

```text
bytes32 keccak256("Tripwire/Screening/payment/v1"),
uint256 destinationChainId, address vault, address guardian, bytes32 routeId,
address token, address sourceSender, uint256 policyVersion, bytes32 policyHash,
bytes32 messageId, bytes32 operationId, address recipient, uint256 amount,
address returnRecipient, bytes32 intentPolicyHash
```

Values come from authenticated credit/current customer state at one coherent
hash-checked destination snapshot, not user overrides or the Watcher's vault
`transfer.from`. SourceSender is the authenticated CCTP message sender; recipient
is the immutable payout beneficiary. Amount is exact net credited USDC. Policy,
operation, source intent and fixed return are bound as well as route/recipient;
a NOT_LISTED receipt cannot move between equal-amount payments or another chain.

Receipt freshness, evaluated against explicit destination block time `now`:

1. `head.listAsOf <= receipt.checkedAt <= now` and active head matches exactly.
2. `receipt.checkedAt <= receipt.validUntil`, with expiry no later than
   `checkedAt + maxObservationAgeSeconds` or the head expiry.
3. `now <= receipt.validUntil` and `now <= head.validUntil`; additionally original
   observation/snapshot ages must stay within their configured maxima.
4. Profile, context, signature, issuer separation and all canonical inputs match.

Equality at expiry/max age remains valid, matching current review's inclusive
expiry semantics. One second later is unavailable. No future tolerance, local
clock fallback or refreshed capture time. Long delay requires a fresh receipt
and review at maturity; it cannot reset either sticky execution deadline.

## Verification results, conflicts and failure handling

Proposed transport uses strict version-1 envelopes: profile fields as listed above;
`{version: 1, head: <the five primary-type fields>, signature}` and
`{version: 1, receipt: <the six primary-type fields>, signature}`. Expected payment
context is supplied separately with exactly the fourteen fields following its
namespace above. Integer transport uses canonical unsigned decimal strings
(no sign, leading zero except "0", exponent or whitespace), parsed to bounded
bigint. Version/outcome use bounded integer literals; hex digests/signatures have
exact byte lengths. EVM boundary validates/checksums addresses without changing
hashed address bytes. No provider text/URL or opaque extra field is accepted.

The pure verifier gets expected chain/vault/route/profile/current roles, active
head hash and exact payment context from its caller. It validates structure,
cryptography, binding and freshness; it **cannot prove those caller inputs came
from canonical chain state** or a real provider. H4c3 must supply them from the
coherent authenticated reader. A valid fixture is explicitly synthetic, not a
live head registration. Pure head-transition validation takes previous head as
an explicit input; no hidden global registry or storage in H4c2.

H4c2 produces only read-only evidence results:

- `verified`: outcome UNKNOWN/NOT_LISTED/MATCHED, original times, bound digests,
  explicit check time and provenance; fixed `authorization: none`.
- `unavailable`: fixed reason, no usable outcome; `authorization: none`.

Closed reason catalog: `missing`, `invalid-input`, `unsupported-version`,
`scope-mismatch`, `profile-mismatch`, `head-mismatch`, `invalid-signature`,
`issuer-conflict`, `future`, `expired`, `contradictory`, `provider-unavailable`.
An external adapter supplies missing/outage through a validated union; an arbitrary
error message cannot determine a reason. No ALLOW, aggregate score, guardian tier,
transaction, signing method, mutation or permissive default in this API.

Required positive/negative semantics:

| Inputs | Evidence result / future mandatory decision |
| :--- | :--- |
| One valid NOT_LISTED for active head/context | Verified NOT_LISTED; future screening gate only may pass |
| One valid MATCHED | Verified MATCHED; future HOLD |
| One valid UNKNOWN | Verified UNKNOWN; future HOLD |
| No receipt, timeout/429/5xx, malformed or unrecognized vendor response | Unavailable; future HOLD |
| Valid MATCHED and NOT_LISTED for same head/context | Unavailable contradictory; future HOLD and retained incident |
| Any conflicting authenticated outcomes for same head/context | Unavailable contradictory; no "newest wins" or majority |
| Forged/invalid extra receipt alongside valid negative | Unavailable batch; no discard-and-ALLOW interpretation |
| Multiple identical signed receipts | Idempotent after bounded deduplication; original capture preserved |
| Old head/profile/issuer receipt | Unavailable; never accepted through fallback |

Input bound: at most 8 receipts for one evaluation; no unbounded sorting/history
or partially valid batch. Conflict is retained for that profile/head/payment scope
by the later durable operator integration. The pure verifier itself does not
persist it. Resolution requires a new issuer-authenticated head and receipt plus
operator reconciliation, not deleting contradictory evidence. It is possible for
an issuer to equivocate and withhold one receipt; the contract cannot see evidence
never submitted. Independent signatures do not eliminate issuer dishonesty.

The later operator persists original signed bytes, accepted profile/head/context,
canonical anchors and incident state in its existing private journal path before
signing/retrying. Raw provider responses, credentials, request URLs and internal
reasons do not enter public reports. Public derived status/digests/times are
unauthenticated snapshots, never reusable execution evidence. A browser import
cannot relay head, change policy or clear HOLD. Existing public report/advisory
versions continue to mean legacy-enforced until a separate versioned adapter is
implemented; never attach new execution meaning to their old fixed markers.

## Explicit customer consent and policy commitments

Proposed execution mode enum for the new contract profile only:
`LEGACY_ENFORCED = 0`, `ADVISORY_V1 = 1`. Other modes refuse. No configurable
heuristic-enforcement thresholds are supported in this version; a future opted-in
enforcement product needs another design, validation and policy commitment.

A newly accepted profile starts paused in LEGACY_ENFORCED with no usable head.
Both modes require the new mandatory screening proof; LEGACY additionally retains
current behavioral enforcement and cannot be selected as a weaker fallback.
To enable advisory, customer authority queues exact mode/profile action under
the existing one-day policy delay, then commits it on-chain. Anyone may relay the
exact authorized action after maturity, not choose another profile. Paused state
remains until the separately queued customer unpause and all acceptance gates.
Customer approval of one payment is not this consent. The user's instruction to
continue repository work is not a customer's funded-policy transaction.

Consent records exact chain/vault/route/token, mode, profileHash/limits, unchanged
customer payment limits/recipient permissions, fixed return and guardian powers.
Policy commit increments version and hashes old hash/new version/exact action;
it invalidates old reviews and approvals, cancels old queued action, and preserves
outstanding credit, operation claims, return requests, spend and sticky delay.
An intent committed under an older policy still requires explicit customer payment
approval, as today; do not rewrite the original hook or intent hash.

The new initial policy hash uses namespace
`Tripwire/CCTP/v2/payment-escrow/v2`, existing ordered constructor bindings and
payment policy/recipients, then `uint8 executionMode, bytes32 screeningProfileHash`.
The exact ABI codec and Solidity constructor must agree in H4c3 fixtures; no hash
computed from this proposed schema is accepted by current code. Existing policy
hash ABI and mutation history remain immutable on legacy deployments.

Permissive mode/profile/age-limit changes and issuer replacement require the
one-day queue/commit. Tightening pause or revoking the screening profile is
immediate authority action: revoke commits policy, invalidates outstanding ALLOW
and leaves screening unavailable. Restoring/replacing a revoked profile is delayed;
no immediate fail-open emergency issuer switch. Guardian oracle rotation also
invalidates reviews; if it collides with issuer/authority, refuse new ALLOW and
execution. Read all roles/profile/head/policy/release at one coherent snapshot.

## New review and execute commitments

Proposed review EIP-712 domain `TripwireProtectedVault`, version **3**, bound to
actual destination chain and vault. Proposed review format **4**:

```text
PaymentReleaseReview(bytes32 releaseHash,uint256 policyVersion,bytes32 policyHash,bytes32 screeningReceiptHash,bytes32 screeningHeadHash,uint64 screeningValidUntil)
```

`releaseHash` keeps the current ReleaseReview ordered fields: messageId, routeId,
token, recipient, exact amount, decision, minimumTier, validUntil and monotonically
increasing per-release nonce. The outer new domain/type prevents old signatures
from becoming new consent or screening proofs.

For ALLOW, review submission supplies the signed head/receipt proof, stores its
commitments, and verifies current active profile/head, exact payment binding,
issuer signature, NOT_LISTED and chain freshness. Review validUntil is no later
than receipt/head expiry, normally at most now+300 seconds and never beyond the
existing 600-second maximum. Execution rechecks current policy/head/issuer/roles,
stored screening expiry and exact credit in addition to all existing gates.
A later head, policy or issuer/oracle rotation blocks a previously included ALLOW.
A reviewed digest without its authenticated original receipt cannot authorize.

HOLD/REJECT use zero screening commitments and do not require a NOT_LISTED receipt.
This permits revocation during provider outage; zero commitments on ALLOW refuse.
Fresh oracle signature, policy version/hash, nonce and review TTL remain required.
REJECT only follows independently established source/backing invalidity in the
authorized operator; the trusted review oracle retains its existing denial power.

Restart reconciles original signed bytes/outbox before making a new attempt.
A newer HOLD nonce supersedes an older ALLOW even if delivered out of order.
An already broadcast execute and a head update race according to canonical chain
inclusion order: the new checks apply at execution, cannot reverse an earlier
finalized payout. Review expiry during customer/guardian delay requires fresh
proof/review, not new operation ID or a fresh credit. Payout and fixed return remain
mutually exclusive; exact finalized paid/returned outcome controls completion.

## Compatibility and rollout matrix

All target identifiers here are proposed, not callable capabilities:

| Boundary | Current customer profile | Target profile | Required refusal/migration |
| :--- | :--- | :--- | :--- |
| Manifest | version 3; legacy 1/2 separately supported | version 4 with exact profile bindings | Old loader rejects 4; new loader never infers mode for 3 |
| Payment escrow marker | PAYMENT_ESCROW_VERSION 1 | 2 | Exact compiled runtime/ABI acceptance; no in-place upgrade assumed |
| Release policy marker | 2 | 3 | Reviewed coordinated operator/contract acceptance |
| Review format / domain | 3 / TripwireProtectedVault 2 | 4 / TripwireProtectedVault 3 | No accepting old signature or adding unsigned fields |
| Customer hook / credit namespace | payment/v1 and payment-escrow/v1 | payment/v2 and payment-escrow/v2 | New own hook; retain Circle framing; never reinterpret old credit |
| Screening | Local boolean list | Profile/head/receipt v1, independent issuer | No boolean/static-list adapter as authenticated proof |
| Guardian | policy 2, legacy aggregate producer | policy 2, isolated reviewed producer | No mixed legacy writer; owner/oracle denial remains disclosed |
| Journal/outbox | Existing deployment/scope/nonces | Explicit new immutable deployment/profile scope | No copying/resetting old claims, nonce, proof or signed bytes |
| Public report/advisory | Existing report, advisory v1 legacy markers | Separate explicit versioned reporting change | Old reports stay read-only with old meanings; no inferred new mode |

A coordinated new deployment is the initial migration strategy. Old credits
continue under their old runtime/policy; settle or return them there. An existing
review, prepaid credit or burn locator is not moved to a new vault. Deployment
acceptance must include exact compiler/artifact/configuration/receipt fingerprints,
issuer role, paused initial mode/profile and no active head, plus separate current
readiness before consent/unpause. Provider/list updates are explicit authenticated
heads, never arbitrary latest HTTP data. Unsupported/mixed versions refuse before
journal opening/signing. Keep one source intent and reconcile real receipts; do
not regenerate keys, IDs or manifests to evade pending state or quarantine.

## Acceptance vectors and ownership

These are required future fixtures, **not new passing tests claimed by H4c1**.
C2 means pure verifier/codec; C3 means coordinated local-EVM/operator integration.

| ID | Vector | Required result | Gate |
| :--- | :--- | :--- | :--- |
| S01 | Valid NOT_LISTED, exact context, active head | Verified evidence, authorization none | C2 |
| S02 | Valid MATCHED / UNKNOWN | Distinct verified outcomes; future HOLD | C2/C3 |
| S03 | Absent receipt / typed provider outage | Fixed unavailable, no false result | C2 |
| S04 | Unknown version/field/enum, floats, overflow, zero IDs | Refuse, no coercion | C2 |
| S05 | Wrong signer, high-s, bad v/length, corrupted fields | Invalid signature/input | C2 |
| S06 | Other chain/vault/route/token/guardian | Scope mismatch | C2 |
| S07 | Different source/operation/message/recipient/net amount/return | Context mismatch | C2 |
| S08 | Old intent/current policy version/hash mismatch | Context mismatch; existing approval semantics persist | C2/C3 |
| S09 | Exact expiry/max-age equality; one second beyond | Valid at equality, then unavailable | C2/C3 |
| S10 | Future snapshot/observation, invalid timestamp order | Unavailable; no local-clock tolerance | C2 |
| S11 | Receipt expiry exceeds head/age limit | Invalid input | C2 |
| S12 | Head rollback, same revision/different digest | Refuse/conflict, never overwrite | C2/C3 |
| S13 | Repeated head/receipt; recheck later | Idempotent without capture/expiry refresh | C2/C3 |
| S14 | MATCHED + NOT_LISTED; UNKNOWN + negative | Contradictory, retain scope; no newest wins | C2/C3 |
| S15 | Invalid extra item; more than 8 receipts | Whole batch unavailable | C2 |
| S16 | Issuer equals current oracle/authority | Issuer conflict, no execution | C2/C3 |
| S17 | New head after ALLOW before execute | Old review unexecutable; fresh evidence required | C3 |
| S18 | Profile/issuer/oracle/policy rotation | Old review/approval invalid as applicable; no fallback | C3 |
| S19 | Older ALLOW arrives after newer HOLD | Nonce rejection | C3 |
| S20 | Old domain/format/manifest/runtime with target operator | Startup/signature refusal | C3 |
| S21 | Missing/forged/expired screening with malicious reviewer ALLOW | On-chain refusal, not only operator refusal | C3 |
| S22 | Valid screening but invalid backing/customer/guardian state | HOLD/REJECT/unexecutable as decision matrix | C3 |
| S23 | All mandatory good; missing baseline/price/high heuristic | Legacy HOLD; consented advisory can ALLOW; no aggregate attestation | C3 |
| S24 | Receipt expires during sticky delay, then renewed | Deadline/spend unchanged, fresh review needed | C3 |
| S25 | Outage after included ALLOW | Contract cannot retroactively revoke solely on unseen outage; TTL/head/explicit HOLD bound exposure | C3 |
| S26 | Paused/frozen/listed recipient with mature requested return | Exact fixed return remains possible, no payout | C3 |
| S27 | Consent queue early/wrong action/revoked profile/unpause | Refuse; no runtime flag bypass | C3 |
| S28 | Restart/crash/finality conflict after head/review/outbox commit | Reconcile same journal; no duplicated terminal outcome | C3 |

Owners must be assigned before live rollout; the repository does not invent team
members or completed approvals:

| Role | Responsibility / trust that remains |
| :--- | :--- |
| Customer authority | Consent, limits, recipients, pause, issuer/profile selection, manual approval |
| Guardian owner | Caps, protected grant, oracle rotation/resume; disclosed ability to affect availability |
| Review oracle/operator | Source/finality/canonical verification and outbox; cannot substitute issuer proof; can still deny service |
| Screening issuer/provider integration owner | Snapshot truth/timestamps, key protection, monotonic heads, outage/rotation process; upstream trust explicit |
| Security reviewer | Pinned implementation/artifacts/configuration review, cross-version and issuer-compromise threat model |
| Pilot operator | Host/process tree, immutable journal, current readiness, actual testnet evidence and incident reconciliation |
| Discovery owner | Provider interface feasibility and customer tolerance for false positives/outage; no outreach sent here |

## Exact next implementation and remaining gates

**H4c2:** implement closed pure screening evidence schemas and read-only verifier
with ABI/EIP-712 codecs under chains/evm, using existing zod/viem. Inject explicit
expected scope/profile/head/payment context, issuer/current roles and check time;
no network, clock read, key loader, durable writes, review decision or signing.
Separate generic domain result vocabulary from EVM address/signature facts.
Implement S01–S16 where pure; actual digest/recovery fixtures must use independently
constructed signing vectors and mutate each binding. Use synthetic fixture keys
only, never real local wallets. No new provider purchase, executable configuration,
contract/artifact, manifest/journal/report or browser behavior in this step.
Document unknown/provider outage and original-capture preservation. Existing
legacy decisions/attestor fixtures must remain unchanged and pass.

**H4c3:** implement and review the coordinated contract/profile/review/operator/
attestor/state/journal boundaries and S17–S28 on local EVM. Pin exact new ABI/hook,
initial policy/action codec and generated artifact agreement, on-chain screening
checks at review AND execute, head publication/reconciliation and rotation invalidation.
No runtime advisory activation before this integration is complete.

**H4c4:** independently review a pinned commit/configuration; prepare a new paused
testnet deployment and explicit customer consent/unpause evidence. A designated
human owns funding/accounts and real receipt collection. Verify mandatory outages,
absence of heuristic-induced guardian actions, fixed return, long delays, restart
and provider rotation on actual canonical transfers. Synthetic fixtures do not
close these gates or show production screening quality.

H1 native picker, H2 host/service/process-tree, H3 real payment receipts, H5 source
bypass/security audit and H6 partner commitment stay open. This design is not an
audit, deployment, purchase, legal clearance or customer-policy signature. Continue
from [the checkpoint](tripwire-progress.md), and commit/push each completed step.
