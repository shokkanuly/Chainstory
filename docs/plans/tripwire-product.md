# Tripwire v1: product contract and execution backlog

Started 2026-10-05 under the user's instruction to execute the product plan.
This document defines the target and release gates; unchecked items are not
implemented features. Existing contract guarantees remain in the linked runbooks.

H4c1 records [the proposed customer advisory/screening policy](tripwire-behavioral-policy.md), ADR-038:
independent issuer evidence, explicit customer consent and coordinated new-version
migration. This is a design only; execution still uses legacy enforcement.
The next H4c2 step implements pure read-only evidence verification, not ALLOW.

## One workflow

A team submits an approved USDC payment on CCTP v2 Standard, Base → Ethereum.
Authenticated destination mint funds a pending escrow request. Tripwire releases
that request only after source/settlement checks and the customer's applicable
payment policy pass. Operators can inspect evidence, resolve holds and use a
precommitted recovery path. Validation starts on Base Sepolia → Ethereum Sepolia.

The guarantee covers payments through the configured escrow. It does not cover
direct treasury transfers, a different mint recipient, another bridge, or a
treasury owner deliberately changing the integration. An all-flow guarantee
requires reviewed source permissions that force the automated sender through
the configured path. Document the treasury owner's bypass powers separately.

## Decision contract

| Layer | Required evidence or rule | Outcome |
| :--- | :--- | :--- |
| Authentication and funding | Configured chains/contracts/asset, authenticated message, exact net mint, beneficiary binding, unique claim | Verified before permission to release; unknown → HOLD; established invalidity → payout rejection |
| Customer payment policy | Current policy hash/version, recipient permissions, amount/budget, approvals, selected delay, pause | Enforced at execution; reviewer cannot bypass the customer's hard constraints |
| Required input health | Finality/canonical evidence, supported message version, mandatory screening if selected | Missing/conflicting/unavailable → HOLD with reason and retry state |
| Behavioral observations | Route size/velocity and optional contract facts | Initially shadow alerts; enforcement requires an explicit reviewed customer policy |
| Recovery | Authenticated precommitted return beneficiary, distinct authority and delay | Separate terminal return path; never arbitrary redirection by the reviewer |

Today the existing scorer still requires a usable baseline, price and screening
for a non-deterministic numeric verdict. The shadow-policy separation above is
target behavior, not a switch shipped by the scorer safety fix. No configuration
may silently turn a missing mandatory source/funding check into ALLOW.

H4a now records the [mandatory/behavioral decision matrix](tripwire-decision-matrix.md)
and adds a pure versioned read-only three-signal projection (ADR-036). It does not
relax existing HOLD/REJECT, enable shadow-only execution, add a customer-consent
field. H4b now adds optional advisory reports/UI (ADR-037), with explicit
unavailability because the keyless observer does not produce behavioral scores.
H4c reviewed scorer/review/operator/contract separation remains a distinct step.

`clear` describes only the configured checks. Optional contract facts may be
absent for an EOA or an unsupported explorer; that is not evidence of a verified
or safe contract. The current screening heuristic's positive signal is also
not equivalent to proof of invalid backing: `releaseDecision` holds it, while
only the independently established source/backing failure causes source REJECT.

## Evidence and accounting

Every request must bind deployment, route, asset, message identity, source burn,
destination mint, exact net credit, payout beneficiary, business-operation ID,
policy version/hash and evidence version. Decisions retain reasons and the actual
on-chain outcome; submitting an ALLOW transaction is not a completed payout.

Money remains bigint token base units. Existing approximate USD statistics are
illustrative signals and cannot determine funded credits, refunds or hard budgets.
Any future HTTP/RPC/provider response is schema-validated at its adapter boundary.

The accounting invariant for each authenticated credit is:

`credited = outstanding + paid + returned`

Paid and returned are mutually exclusive terminal outcomes. An unsolicited USDC
transfer does not create a credit, alter its beneficiary or become withdrawable
through an administrator's discretionary sweep. Recovery must consume only that
request's authenticated net mint and cannot spend another request's backing.

## P0 delivery backlog

| ID | Work | Status | Acceptance evidence | Role |
| :--- | :--- | :--- | :--- | :--- |
| P0-01 | Scorer cannot clear unavailable or malformed inputs | Implemented locally | Regression fixtures for screening outage/exception/snapshot, wrong/future/invalid baseline, invalid USD/history/clock/config; watcher HOLD→retry and exact mismatch REJECT | Operator engineer |
| P0-02 | Record guarantee, bypass powers and truthful demo scope | Specification and local demo copy updated; source permission review pending | This contract, corrected README and web copy; actual treasury integration enumerates every allowed outgoing path | Security lead + product owner |
| P0-03 | Versioned customer policy and signature binding | Contract and durable operator implemented locally; external review/live acceptance pending | ADR-021/022, checked customer constraints and format-3 signatures, stale ALLOW blocked; [contract](tripwire-payment-policy.md), [operator](tripwire-payment-operator.md) | Contract + operator engineer |
| P0-04 | Funded-credit recovery | Contract/queue/returned outcomes implemented locally; verified live recovery still blocks real-money pilot | Authenticated fixed return address, single-use exact return, recovery outbox/finality/restart and accounting; [runbook](tripwire-payment-operator.md) | Contract + operator engineer + security lead |
| P0-05 | Source permissions and operation identity | Local intent/operation/source binding implemented; source bypass controls pending | Business operation binds net mint/beneficiary/return/intent policy; unrelated depositors cannot reserve IDs; alternate source permissions/destinations need review | Integration engineer |
| P0-06 | External design review and audit scope | Scope below; vendor review pending | Independent review of new escrow/policy/source binding/operator threat model; audit pins commit, artifact hashes and deployment configuration | Security lead |
| P0-07 | Real testnet evidence | Preflight, receipt-backed deployment acceptance and [first-payment preparation](tripwire-first-payment.md) available; public deployment/transfer pending | Fresh verified deployment, finalized real burn→mint→escrow→review→payout plus HOLD/retry and recovery evidence; archived receipts/provenance | Operator engineer |
| P0-08 | Partner discovery | Kit prepared; no interviews or outreach completed | 30 qualified prospects, 12 process interviews, 3 design-partner candidates, 1 written pilot commitment; targets, not claimed results | Founder/product owner |
| P0-09 | Customer operations UI | [Read-only snapshot viewer](tripwire-operations.md), receipt timelines and bounded one-shot discovery implemented locally; durable discovery and bounded catch-up added; watch discovery and local browser folder refresh added (native picker end-to-end unverified); bounded public-report archival added; hosted data, expanded discovery retention and full measurements pending | Public readiness/customer observer reports, exact coverage/gaps, held/rejected/paid/returned distinctions and receipt evidence; no browser signing | App + operator engineer |

Roles are assignments to make, not people already hired or booked. The user has
confirmed a team and audit/pilot budget; actual owners, spend and service vendors
must be recorded by the team. No new SaaS backend is authorized by this document.
Persistent execution state stays in the standalone operator under ADR-015; the
browser and existing proxy services keep their read-only/stateless boundaries.

## Policy/recovery release acceptance: P0-03 and P0-04

1. Write an ADR and threat model before changing immutable contracts or signed
   review formats. Keep the current deployment incompatible with the new format.
2. Specify which policy changes invalidate outstanding allowances, which tighten
   immediately and which require delayed customer authorization. Hash canonical
   policy data; never hash UI prose or an ambiguous JSON serialization.
3. Bind return authority and beneficiary to the source operation/authenticated
   hook before mint. Manifest-v3 product receipts now verify beneficiary, fixed
   return, operation and source-intent policy; legacy profiles remain incompatible.
4. Define state transitions for PENDING, HELD, ALLOWED, EXECUTED, REJECTED and the
   new return states. Preserve rejection of the original payout after recovery;
   do not let `resume`, expired protection or reviewer rotation reopen it.
5. Test execute/return races, reentrancy/rollback, duplicate messages, signature
   replay across deployments/policies, policy changes during delay, malicious
   reviewer/admin, old review formats, partial/failed refunds and donations.
6. Update adapter schemas, durable state versioning, operator outbox, audit views
   and migration behavior together. Reconcile actual receipts before finalizing.

Destination USDC recovery and cross-chain return are distinct operations. The
first returns escrowed USDC to the authenticated destination beneficiary. It
does not undo a source burn or promise automatic bridging back. Reverting an
unauthenticated mint creates no funded credit; a source burn awaiting settlement
needs a CCTP operational recovery procedure, not an escrow refund.

## External review brief

Review source intent and permissions, authenticated mint/hook boundary, claim
identity and uniqueness, exact amount/fees, policy and signature replay, owner
and reviewer powers, route isolation/budget splitting, ALLOW expiry/delay races,
refund provenance/accounting, token failure/reentrancy, finality conflicts,
outbox crash recovery, compromised RPC, gas/nonce outages and key rotation.

Deliverables: prioritized findings with reproductions, remediation review on a
pinned commit, verified artifact/configuration checklist, residual trust assumptions
and deployment limitations. No external audit is represented as completed.

## Testnet measurement and pilot gates

Record source burn inclusion/finality, destination mint inclusion/finality,
first assessment, confirmed review, delay maturity, confirmed payout/return and
final acknowledgement. Report each duration separately; CCTP settlement time is
not Tripwire-added latency. Retain HOLD reasons, dependency outages, retry counts,
manual interventions and eventual outcomes. Avoid double-counting retries as new
payments or synthetic attack amounts as prevented financial losses.

Before enforcement, agree with the partner on eligible payments, exposure limit,
delay tolerance, stop conditions and a success threshold. Exposure includes
burned-but-unminted USDC, escrowed funds and allowed-but-unexecuted requests.
Pause new initiation/escalate if evidence conflicts, queues cannot reconcile,
unexpected credit/accounting appears or a mandatory dependency is unavailable.
Do not auto-release existing holds merely to restore a service metric.

Mainnet gate: independent review of the actual release; recovered testnet funds
and completed failure drills; verified deployed bytecode/config; separate role
keys and reviewed source permissions; partner-approved limits and operating
procedures. A production launch remains a separate decision.

## Delivery sequence

Weeks 1–2: P0 input safety, interview evidence, guarantee/threat model and design
review. Weeks 3–4: policy and funded recovery, source binding, contract regressions.
Weeks 5–6: receipt-backed testnet workflow, automatic request discovery and durable
recovery drills. Weeks 7–8: read-only operations UI and shadow run with a partner.
Weeks 9–10: audit, fixes and remediation review. Weeks 11–12: repeat drills,
partner acceptance and a bounded mainnet go/no-go decision. Schedule is conditional
on evidence, not a deadline to bypass a release gate.

Related: [hardening](tripwire-hardening.md), [CCTP](tripwire-cctp.md),
[operator](tripwire-operator.md), [route policy](tripwire-route-policy.md),
[testnet pilot](tripwire-pilot.md), [partner discovery](tripwire-partners.md).
