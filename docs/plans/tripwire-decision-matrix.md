# Tripwire H4a: mandatory checks and read-only behavioral signals

Implemented locally 2026-10-07, ADR-036. This matrix describes the current
payment-v3 prototype and the review required for future separation. H4a adds a
pure read-only projection; **shadow-only execution is not enabled**. Existing
scorer, watcher, release decisions, attestor, contracts, signatures and journals
are unchanged. H4b public report/UI integration and H4c enforcement changes are
separate steps. This is not a deployment, audit or approved pilot policy.

**Follow-up:** H4b report/viewer integration is now implemented under ADR-037;
see the [optional advisory contract](tripwire-operations.md#behavioral-advisory-reports-and-viewer-adr-037).
The implementation-at-H4a statements below are retained as the model's original
boundary. Current keyless exports report assessment-not-produced; H4c1 proposed
policy design is recorded below, while execution separation remains open.

## What can authorize payment today

Authenticated mint creates a fixed funded credit; the operator's current
source/risk/customer checks determine its review, and the escrow independently
checks current customer/guardian/review constraints at execution. A positive
heuristic report never authenticates a burn, creates a credit or overrides a
recipient, amount, pause, approval, delay, return intent or policy version.

Only an actual supported policy-bound signature and successful contract execution
can advance payout. `releaseDecision(ALLOW)` alone does not mean eligible
customer state, a submitted transaction does not mean paid, and included state
does not mean finalized completion. A compromised reviewer remains a trust risk
for off-chain checks such as screening; the current contract has no screening
provider or behavioral-policy commitment. It also does not verify a consensus
light-client proof independently of the accepted RPC/Circle trust assumptions.

Below, **HOLD/retry** preserves the queue and rechecks; **REJECT** is terminal for
the original payout, while a funded credit can still use customer recovery;
**stop/quarantine** requires reconciliation with original scoped state.
Unknown data is never proof of established invalidity.

## Mandatory matrix: current behavior and trust owners

These are role assignments for the team to make, not named people already assigned.
All current gates stay mandatory during H4a/H4b. Names refer to checks, not a new
configurable runtime policy or a second release-decision function.

| Check | Evidence and current enforcement | Missing / malformed / outage / expiry | Failed established condition | Trust owner / negative fixtures |
| :--- | :--- | :--- | :--- | :--- |
| Deployment and scope | Configured route/chains/token/Circle/escrow/guardian, supported markers, exact accepted runtime; scoped journal | Startup refuses invalid deployment; unknown/transient RPC handling follows ADR-033/034; changed scope cannot fall back to another profile | Stop; preserve existing deployment/journal | Integration + security; `cctpPaymentOperator`: replaced runtime / old review format; `cctpPaymentSource`: different legacy/sender/return scope |
| Source burn provenance | Successful canonical finalized receipt, exact source emitter/transaction/log, matching DepositForBurn and supported Standard message | Pending/unavailable → HOLD; unknown version/hook/Fast profile never becomes supported automatically | Verified binding mismatch → INVALID/REJECT, not a guess from an absent receipt | Source verifier + RPC/Circle; `cctpSource`: missing/unfinalized receipts, unsupported version/hook/Fast, ambiguous batches |
| Destination mint and net credit | Successful canonical finalized mint/receive/fund/bound/request receipt set, exact mint minus fee in bigint USDC units; exclusive escrow caller | Burn alone / missing or malformed destination evidence → HOLD without a funded proof | Proven token/domain/recipient/body/amount/fee/caller mismatch → INVALID/REJECT | Settlement verifier + Circle/token; `cctpSource`: burn alone; mismatched destination token/amount/fee/caller |
| Customer source and application intent | Authenticated source sender, immutable return account, payout beneficiary, business operation and source policy hash | Missing/duplicate/out-of-order binding logs → unavailable/HOLD; incompatible hook refused | Forged sender/return/operation/policy/message binding invalid; unsupported messages cannot create credit | Customer + integration; `cctpPaymentSource`: forged bindings, missing/duplicate/emitter logs; payment EVM: unrelated depositor / unapproved return |
| Unique claims and operation | Durable source/settlement/nonce/operation claims, contract used-nonce/operation guards | Local write/read failure stops before signing; do not clear/recreate claims on retry | Reused claim cannot become a second payout/credit | Operator + contract; `cctpSource`: reused mint/nonce; `cctpPaymentSource`: duplicate operation; H2b1 post-commit journal fixtures |
| Finality/canonical consistency | Saved source/destination checkpoints rechecked before signed-work recovery and publication; terminal completion finalized | RPC behind → retry, no rewind; missing tag → unavailable; never substitute latest for required finality | Changed committed finalized history → quarantine; local quarantine-write failure → journal stop | Operator + RPC; `finalityFeed`: changed committed block/lag/unavailable tag; `cctpSource`: finalized block quarantine |
| Current customer state | All relevant policy/credit/release facts at one hash-checked block, bounded below by observed settlement/writes | Malformed, lagging or mixed snapshot cannot be eligible; retry/refuse, finalized contradiction quarantines | Recipient/amount/intent/terminal contradictions refused | Operator + customer; `paymentState`: malformed credits/releases/policy, behind RPC, block hash change |
| Policy identity and version | Format-3 review commits release hash + current policyVersion/policyHash; version checked at execution | Stale/missing review has no execution permission; policy change needs fresh review and applicable customer approval | Old policy/type/domain signature refused | Customer + reviewer; payment EVM: old type/another chain/vault/policy; policy change invalidates ALLOW/approval |
| Recipient permission | Current permittedRecipients for immutable payout beneficiary; checked on-chain at execution | Cannot guess permission from missing RPC or a past report | Customer revocation blocks execution immediately; approval does not override it | Customer; payment EVM: valid oracle cannot bypass recipient; `paymentState`: approval never overrides recipient |
| Exact amount limit | Full authenticated net amount ≤ current maxPayment, bigint base units | Invalid amount/threshold snapshot refused; approximate USD is not a substitute | Exceeded max blocks execution even with oracle/customer approval | Customer + contract; payment EVM: maxPayment bypass; `paymentState`: amount gate |
| Current-version approval | Required when amount > manualApprovalAbove **or** source intent hash differs from current hash | No approval or wrong version → HOLD/contract refusal; not inferred from old approval | Reviewer cannot manufacture approval or override other gates | Customer; payment EVM: authority/current-version approval, older intent below threshold |
| Pause | paymentsPaused current value, contract checked at execution | Unknown state never means unpaused | Customer pause blocks payout and invalidates prior version; return path has separate rules | Customer; payment EVM: pause bypass; `paymentState`: paused gate |
| Customer/guardian delay | Sticky request deadlines, max of current clocks; first applicable ALLOW starts clock, chain time measures maturity | Expired review during delay requires fresh review; unavailable clock/state → retry | No early execution, shortened/restarted clock or owner-resume bypass | Customer + guardian; payment EVM: retry/expiry/customer delay; `routeLimits`: sticky delay / clock not started |
| Review authenticity and lifetime | Current oracle signer, destination chain/vault, every release field, monotonic nonce, TTL ≤ 600 seconds, current review at execute | Missing/HOLD/expired/replayed review cannot pay | Foreign signer/chain/vault/field/type, old nonce or rotated oracle refused | Reviewer key + contract; `releaseSafety`: forged fields, replay, older ALLOW after HOLD, expiry/rotation |
| Guardian constraints and budget | Required active tier, protected route/caller, rolling base-unit cap and outflow checks | Protection state unavailable or rejected → operator retry; unknown RPC simulation cannot certify execution | FREEZE/delay/cap/route mismatch reverts without spending credit | Guardian owner + contract; `releaseSafety`: protection missing; `routeLimits`: route isolation, split bursts, resume preserves spend |
| Required screening | Current scorer requires a usable boolean observation; positive observation is an independent listed-address signal | Null, thrown/malformed lookup → indeterminate/HOLD; no optional opt-out in this release | Positive signal currently drives score 1 / HOLD and guardian escalation; **not** proof of invalid backing / source REJECT | Screening owner + reviewer; `riskScorerSafety`: null/exception/malformed/label failure; `watcherSafety`: retry recovery / mismatch survives outage |
| Return intent and maturity | Customer's authenticated immutable return account alone requests recall; request locks review/payout; fixed delay; return consumes exact credit once | No request → no return; missing source/port → operator HOLD; unmatured → return-pending; unknown terminal state not acknowledged | Operator/owner cannot request/redirection; payout and return mutually exclusive | Customer recovery controller + contract; payment EVM: return locks payout, unauthorized request, early/after-paid return, during pause/FREEZE |
| Durable execution/completion | Original signed bytes/nonce/outbox reused; exact matching finalized terminal state before queue acknowledgement | Signing/network/inclusion uncertainty → reconcile/retry with original bytes; no new transfer to repair report publication | Conflicting terminal outcome/journal scope refused; token failure rolls state/totals back | Operator + token/RPC; `cctpPaymentOperator`: return crash/restart/finality; payment EVM: transfer revert/reentrancy/accounting |

Fixture suites are repository files under `scripts/tripwire/__tests__/`,
`src/tripwire/__tests__/` and `contracts/evm/test/`; they use synthetic evidence,
not a real Circle attester, live balances or external audit. Existing guard
fixtures remain the authority for each row; H4a does not reimplement their gates.

## Behavioral matrix: current vs intended separation

| Signal/input | Current effect | Missing, invalid, stale or outage today | Read-only H4a projection | Future reviewed change / owner |
| :--- | :--- | :--- | :--- | :--- |
| `size_vs_baseline` | Included in weighted score/severe floor; may contribute to tier/review behavior | Missing price or usable route baseline → indeterminate/HOLD unless independent deterministic evidence already dominates | Copy its existing score, never recompute threshold or grant permission | Candidate advisory-only signal; customer/product owner must specify explicit enforcement consent |
| `withdrawal_velocity` | Same score pipeline; contract-risk corroboration may justify DELAY | Invalid relevant recent amounts/timestamps → indeterminate/HOLD; missing data is not zero-volume history | Copy existing signal if actually reported; absent stays unavailable | Candidate advisory-only; data owner must prove coverage/dedup/window and characterize false alerts |
| `contract_risk` | Optional signal; severe score can floor THROTTLE and corroborate DELAY | Absent optional facts do not prove safe/verified; thrown configured recipient lookup makes Watcher indeterminate unless score 1 dominates | Report numeric indicator only; no accusation, raw prose/admin labels or independent proof | Candidate advisory-only; explorer facts/age are not proof of malicious intent |
| Baseline health | Route-matched, sufficient samples, nonfuture age ≤ six hours by default; usable statistics required today | Missing/stale/thin/invalid → HOLD; fabricated baseline cannot enable pilot | Do not manufacture any missing size/velocity signal | Future signal availability belongs to data owner, not hard customer amount limits |
| Approximate USD / recent history / clocks | Inputs to illustrative heuristics; current release health requires usable price/history/clock | Missing/invalid pricing, history or clock → HOLD, never substitute zero | No repricing, amount calculation or freshness refresh; projection has explicit original capture/check times | Future pricing/coverage service requires provenance; USDC ≠ guaranteed fixed $1 price |
| `proof_payout_mismatch` | Exact adapter backing invalidity can REJECT and drive protection; legacy USD proof is only demo logic | Missing proof is unavailable, malformed USD is not proof of mismatch | Excluded from behavioral vocabulary; never relabel it as optional | Mandatory exact backing stays independent of any behavioral weighting |
| `counterparty_screen` | Current required-input health + independent positive-list signal | Unavailable stays HOLD; positive list signal is not established invalid source backing | Excluded from behavioral vocabulary | No opt-out introduced; future provider/freshness/policy selection must be explicit and reviewed |

Size/velocity/contract scores are hand-set illustrative indicators, **not**
probabilities of compromise, losses prevented or calibrated production evidence.
Target intent is initially advisory behavior. That target cannot be activated by
removing baseline/price health checks alone: scorer, release review, attestor,
operator, execution-policy commitments and compatible deployment constraints must
be reviewed together. `PaymentPolicy` currently has no behavioral-consent or
screening-provider fields. H4a invents none and accepts no `shadow-only` switch.

## Read-only model and compatibility

`src/domain/behavioralShadow.ts` owns strict version-1 schema/types and shared
capture/scope context. `src/tripwire/behavioralShadow.ts` projects an already
computed assessment. No network, clock read, repricing, second scoring algorithm,
storage, guardian tier, signature or release-decision call is added to this path.
The caller must supply the original assessment capture time, explicit current
check time, expected route/transfer identity and synthetic provenance. A report
does not authenticate those caller claims or the scorer's data completeness.

Fixed markers: `mode: behavioral-shadow`, `enforcement: false`,
`authorization: none`, `executionPolicy: legacy-enforced`, `source: existing-scorer`.
All three supported signals occur once in fixed order. A reported signal contains
only its original 0–1 score and `existing-scorer-signal` reference; that reference
means a scorer output was supplied, not an authenticated external evidence bundle.
Unavailable scores are `null`, with fixed reasons `not-reported`, `invalid-signal`,
`stale-assessment`, `future-assessment`; they cannot be numeric zero.

`capturedAt`/`checkedAt` are safe integer Unix seconds; capture time is independent
of transfer inclusion time. Default `maxAgeSeconds` is 300, configurable 1–21600
for this display model only; it does not change baseline expiry or review TTL.
Age exactly equal to the limit is current; larger age suppresses every score.
Any future capture is separately flagged and also suppresses scores. Invalid
clock/scope/input returns a fixed typed refusal with no fabricated report.
Malformed/duplicate/deterministic-tagged behavioral entries cannot be reported
as usable. Known mandatory signals are never copied. Raw source reason strings,
aggregate verdict/score, prices, thresholds/weights/floors and payment fields are
not exported. Scope mismatch/unknown input IDs refuse the projection.

The standalone synthetic JSON fixture demonstrates the format; it cannot be
imported as an operations/payment report. There is no new observer export flag,
optional public-report field or UI panel at H4a. ADR-037 subsequently adds that
optional display extension without enabling enforcement. Existing review
format 3/domain 2, contracts/artifacts, journal scope/schema, CLI permissions and
operator decisions stay compatible and unchanged. Old report consumers do not
silently interpret this model as an execution assessment.

## Acceptance and next step

New projection/schema fixtures test known heuristic copies, unavailable contract
facts, aggregate-indeterminate with an observed contract indicator, source/backing/
screening/baseline/price failure with unchanged HOLD/REJECT, exact freshness bounds,
stale/future suppression, missing/malformed/duplicate signals, scope refusal,
mandatory-signal and execution-field injection, version/order completeness and
raw-reason redaction. The full existing contract/operator negative fixtures above
remain required. These checks do not enable behavioral separation in production.

Local validation: **1,460 tests across 70 files**, including **39 new cases**;
build/typechecks and lint passed. No live RPC, key access or chain transaction
was needed for this step.

H4b acceptance (now implemented under ADR-037): add a clearly labelled optional advisory projection to actual keyless
customer reports and the read-only viewer, with a scoped original capture time,
backward-compatible parsing and unavailable-state replacement. Do not connect it
to review/attestor/release decisions or fabricate a baseline for the keyless
observer. It currently has no behavioral assessment to export; document that
availability explicitly rather than emitting invented scores. H4c must separately
design explicit customer consent, mandatory screening provenance/freshness and
compatible scorer/review/operator/contract policy before any enforcement change.

H1 native picker, H2 host/process-tree/service acceptance, H3 real funded
testnet workflow, H5 independent/source review and H6 partner commitment remain
open. No public deployment/payment, key access or external audit is claimed.

H4c1 now records [the concrete proposed policy](tripwire-behavioral-policy.md)
and ADR-038. It specifies customer consent, independent screening issuer/head/
receipt commitments, freshness/conflict/rotation outcomes and a new deployment
compatibility matrix. No target version or execution mode has been implemented.
Next H4c2 verifies evidence read-only; this matrix still describes current runtime.
