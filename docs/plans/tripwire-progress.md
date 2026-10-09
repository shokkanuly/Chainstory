# Tripwire: current continuation point

Updated **9 October 2026**. Branch: `main` (via the integration PR from
`claude/platform-motion-site-animations-65pkoi`). Main plan and limits:
[handoff](tripwire-handoff.md). This file is updated with every completed step,
together with its code and checks. Find this file's current commit with
`git log -1 -- docs/plans/tripwire-progress.md`; do not paste a commit's own
future hash into it. History before 9 October was translated from Russian;
its facts and numbers are unchanged.

## Completed step: integration onto policy v4, H4c2, H1 (automated), H5 package — 2026-10-09

**Integration (ADR-046).** The payment track was merged into `main` on top of
guardian policy v4 (merge commit `d90434f`). The vault keeps the k-of-n quorum
reviewer and gains the payment hooks. The operator keeps v4 behavior (REJECT
hold, lane block, held backoff, verdict reasons) and adds customer returns and
policy blockers. Payment reviews are signed by the oracle and paid for by a relayer.
In the payment escrow a REJECT stays final, because the fixed customer return is
the exit (test + mutant). The live v4 Sepolia vault, deployed before the
review-format getter, still reads as format 2. The keyless observer keeps
failover and the independent verifier quorum through a keyless `testnet/rpc.ts`.
Observer launchers silence Node 22's SQLite ExperimentalWarning, which had broken
the one-line stderr diagnostic on CI's Node. Payment ADR-021–038 became
ADR-028–045. The handoff and this file were translated to English.

**H4c2 — pure screening evidence verifier (ADR-045).** `src/domain/screening.ts`
holds the read-only vocabulary (outcomes, closed reason catalog, verified /
unavailable results, `authorization: 'none'`). `src/chains/evm/screening.ts` holds
the strict version-1 schemas (canonical decimal integers, checksummed addresses,
nonzero digests), the profile and payment-context ABI hashes, the EIP-712 head and
receipt digests, and canonical low-s 65-byte signature recovery. Two functions:
`verifyScreeningEvidence` and `screeningHeadTransition`. They read no clock,
network, key or storage, and return no decision, score, tier or signature. A batch
is all-or-nothing (at most 8 receipts); identical receipts deduplicate; differing
outcomes are `contradictory`. A context mismatch reports `scope-mismatch`, because
the catalog is closed and the payment context is the receipt's scope. When several
distinct receipts agree, the one that expires first is reported. Tests:
`src/chains/evm/__tests__/screening.test.ts`, 29 cases covering S01–S16. The
expected digests are rebuilt by hand from raw ABI words and the EIP-712 prefix.
Only synthetic keys are used. The verifier is not wired into the Watcher, review,
attestor, operator, contracts or reports.

**H1 — folder follow in a real browser (automated part).**
`scripts/smoke/operationsFolder.mjs` drives Chromium against the built site with a
real `FileSystemDirectoryHandle` from the origin-private file system. It covered
everything after the picker, 12/12 checks:
- four synthetic payments, then an outage replacing every row, then a newer
  healthy report bringing them back;
- a corrupted newest file and a deleted newest file, both without falling back
  to an older report;
- a 390 px layout with no horizontal scroll;
- Disconnect, reload, and a browser without the API (button disabled);
- no page errors.

Playwright is not a project dependency; the script header shows how to run it.
**Still open:** the native directory dialog itself and revoking permission, which
need a person in a real browser.

**H5 — audit package.** [tripwire-audit-package.md](tripwire-audit-package.md)
holds:
- scope and the exact compiler settings;
- initcode fingerprints;
- each role's powers and the bypass paths;
- review priorities, evidence, and questions the team must answer.

No vendor has been chosen and no audit has been done.

**Checks (clean clone, Node 22.22.2):**
- `npm ci`, lint, typecheck and build pass; a fresh compile reproduces the committed artifacts.
- **1,668 tests / 80 files**, passing twice; **80 / 80 mutants caught**.
- Both local demos pass.
- Every route passes in real Chromium at 1280 and 390 px (`scripts/smoke/siteRoutes.mjs`, 20/20).

The route check found two phone overflows, now fixed: `/app`'s toolbar and the
home page's scroll-in cards. Two real-subprocess tests got a 30 s budget because
they start up to four Node/tsx processes. No public RPC, keys, deployment, payment
or external audit.

## Next independent engineering step: H4c3 — coordinated screening integration

The contract, profile, review, operator, attestor, state and journal boundaries,
with S17–S28 on a local EVM, per [the H4c1 policy](tripwire-behavioral-policy.md).
This means new escrow/release/review-format/domain/manifest versions and a new
deployment. Do not activate advisory mode before this lands and is reviewed. The
H4c2 verifier is the building block: H4c3 must feed it scope, roles, active head
and payment context read at one coherent, hash-checked block.

## History: H4c1 — policy design and compatibility contract (7 October)

Starting point: `012a01a`, pushed and checked on GitHub. Created
[the concrete proposed policy](tripwire-behavioral-policy.md) and ADR-045:
- the exact current-vs-target decision matrix and the consent/policy commitments;
- the independent screening issuer, head and receipt, with their ABI/EIP-712 binding;
- freshness, conflict, rotation/replay rules, and version/deployment migration.

**This is documentation, not a new mode.**

The target advisory is separate from the mandatory source/mint/customer/guardian
gates:
- missing, invalid, stale, unknown or contradictory screening → HOLD;
- a positive list match → HOLD of that specific payment;
- a negative result passes only the screening gate. NOT_LISTED does not mean
  safe or legally cleared.

The exact net credit, sourceSender, operation, message, recipient, return, and
current and intent policy are bound to the receipt. An independent issuer's
signature and the active head are checked at a future ALLOW and at execute. The
original observation and snapshot times are not refreshed by re-importing or
re-signing. The provider and the upstream conversion remain trust points; no
vendor has been chosen.

Explicit customer consent goes through the one-day queue/commit; a CLI, report or
approval does not replace it. The proposed versions need coordinated
implementation and a new deployment:
- escrow 2, release-policy 3, review-format 4, domain 3, manifest 4;
- its own hook/namespace v2.

Old credits, signatures, journals and outboxes keep their original meaning. The
contract return stays fixed, customer-requested and independent of screening
availability.

An authorized advisory producer stops passing the aggregate to the attestor,
choosing the minimum tier and refreshing protection from heuristics. Guardian
caps, active tiers and sticky delays stay. An isolated producer/route is
mandatory. The guardian still trusts its owner and oracle, who can stop a route;
vault consent does not remove those rights cryptographically. Unpublished updates,
issuer equivocation and an already finalized payout cannot be undone by one receipt.

Checks: the existing **1,496 tests / 72 files**, build/typechecks and lint passed;
local Markdown links, code references and the documentation-only diff were
checked. There were no new runtime fixtures: the 28 acceptance vectors in the
specification are requirements for future H4c2/H4c3, not tests already passing.
Code, contracts/artifacts, formats/configuration, scorer/Watcher/attestor/
operator, SQLite/report/UI did not change. No public RPC, keys,
deployment/payment, provider purchase, service or audit.

## History: H4b — optional advisory report and read-only viewer

Starting point: `fd89814`, pushed and checked on GitHub. ADR-044 and the
[report/display contract](tripwire-operations.md#behavioral-advisory-reports-and-viewer-adr-044)
describe an optional per-payment `behavioral` version 1. A strict domain union
holds either a reported H4a assessment or `unavailable` with a fixed reason and
no scores. The wrapper uses the existing projector; there is no new scorer or provider.

The actual keyless customer observer always exports assessment-not-produced,
including on a per-payment state outage: it has no behavioral assessment yet. The
reported form is supported by the importer and a synthetic fixture, but no live
producer was added. Old reports without the extension stay valid and show
absence, not zero risk. The route, canonical messageId and synthetic marker match
the parent report. checkedAt equals observedAt rounded down to Unix seconds. The
original capturedAt is kept. Checking these caller fields does not authenticate
the assessment's source.

Payment details show a separate **Behavioral signals · Advisory only** panel,
with the original indicators, capture time, age and fixed missing reasons. These
are never shown as usable:
- a stale or future assessment;
- an assessment when the browser clock is behind the export;
- scores that were suppressed before.

The existing 30-second timer updates the displayed age; background throttling can
delay it. It is not an execution clock or TTL. Old data is replaced entirely on an
outage, refusal, scope change or explicit absence. Payment states, mandatory
blockers, exact money and receipt references are kept.

Checks: **1,496 tests / 72 files**, **36 new**; build/typechecks and lint passed.
The fixtures cover:
- the flow from a synthetic audit to an exclusive public file to an import;
- a per-row state outage;
- the existing scorer's projection and redaction, with the HOLD unchanged;
- compatibility between old and new reports;
- refusal of a wrong scope, provenance, check clock, version or injected field;
- stale and future boundaries;
- folder replacement and the rendered read-only UI.

An in-app browser smoke covered synthetic aged signals, explicit absence, clearing
after a malformed import, a global outage, and desktop and 390 px layouts. The
native folder picker was not checked; H1 stayed open. The smoke screenshots were
local, not Git or live evidence.

The scorer, Watcher, review, attestor, signing operator, contracts/artifacts,
format 3/domain 2, manifest/journal/SQLite and execution policy did not change.
No public RPC, key reads, deployment/payment, live calibrated behavioral producer,
service or external audit. **H4b was complete locally; H4 as a whole stayed open.**
Shadow-only execution is not enabled.

## History: H4a — decision matrix and read-only behavioral model

Starting point: `ee7e926`, pushed and checked on GitHub. Added the
[matrix/runbook](tripwire-decision-matrix.md) and ADR-043. They cover the
mandatory gates (source, mint, customer, recipient, amount, approval, pause,
delay, recovery, screening), each gate's outcome when its input is missing,
malformed, unavailable or expired, the owner roles, and the existing negative
fixtures. Size, velocity and contract heuristics are described separately from
mandatory backing and screening; no new configurable execution policy was added.

`src/domain/behavioralShadow.ts` defines a strict version-1 display-only schema;
`src/tripwire/behavioralShadow.ts` projects only the three already computed
signals. There is no second scorer, I/O, clock read, signature, guardian tier or
release-decision call. Mandatory signals are not copied. Scope is checked against
the original route/transfer; the caller passes the original capture time, check
time and synthetic marker. These fields do not prove the original assessment is
true or complete.

Missing, invalid or duplicate signals stay unavailable with `score: null`. A stale
or future capture suppresses all scores; a re-check does not refresh the time.
`enforcement: false`, `authorization: none` and `executionPolicy: legacy-enforced`
are fixed. ALLOW, signatures, an aggregate verdict and unknown fields are rejected.
The standalone synthetic fixture is not an operations report.

Checks: **1,460 tests / 70 files**, **39 new**; build/typechecks and lint passed.
The fixtures check scope, clock and expiry boundaries, unavailable and malformed
signals, forbidden execution or mandatory fields, the absence of raw reasons, and
no mutation. Differential cases keep the original HOLD/REJECT on
source/backing/screening/baseline/price failures. Contracts, scorer, Watcher,
attestor, operator, review format/domain, reports and journal did not change.

## History: H2b2 — process supervision and local incidents

Starting point: `3c0fac2`, pushed and checked on GitHub. Added
`tripwire:cctp:supervise`, a strict public-path configuration and a repo example.
It launches exactly the keyless observer through direct Node/tsx, with no shell
or signing entrypoint. Paths resolve relative to the configuration file; incident
and report folders are separate from the manifest and journal. Only the RPC
transport and a minimal OS environment pass to the child: no wallet variables,
NODE_OPTIONS or HOME.

Restart rules:
- Exit 75 is allowed a restart. SIGKILL/SIGABRT/SIGSEGV/SIGBUS restart only with
  an explicit `restartOnCrash: true`.
- Exit 0 does not repeat. 70, 74, 78 and all other numeric errors are terminal.
- The budget is 0–10 extra launches with an exponential delay of 1–300 s, and it
  does not reset between child launches.
- Exhausting the budget gives 78, for human reconciliation. A new manual
  supervisor run starts a new budget, so the runbook forbids an endless external
  restart wrapper.
- The watch mode's RPC polling keeps its own capped backoff; that is not a
  process restart.

The supervisor waits for exit and stdio closure before the next child.
SIGINT/SIGTERM interrupts the backoff, sends SIGTERM to the child and waits for
cleanup. Exceeding the grace period sends SIGKILL, records an incident and exits
terminal 78 with no restart. A separate OS-released SQLite lease in the private
incident directory excludes a second supervisor; the operator's journal, schema
and lease did not change. A failure to publish an incident stops the child,
waits for closure and gives 74.

Local immutable incident JSON/NDJSON holds only runId/time and fixed process or
report condition fields. Raw stderr, errors, URLs, paths, body reasons and payment
rows are not copied. The monitor reuses the public adapter and filename codec,
checks the newest snapshot up to 2 MB / 10,000 top-level entries, and refuses a
wrong scope, ties, deletions and non-regular files. It marks the original
staleness or future time, retrying/stopped/quarantine, and discovery
backlog/gaps/capacity; re-checking a file does not refresh its capture time.
Events are written on state transitions. An empty conditions list does not prove
liveness, execution or treasury completeness. Incident files are kept, so total
disk usage grows.

Checks: **1,421 tests / 69 files**, **58 new**; build/typechecks and lint passed.
Real Node/tsx subprocesses ran the audit, discovery, SQLite and export against
synthetic serialized RPC ports (not selectable from the production CLI). Checked:
- a startup outage, and SIGKILL before and after publication;
- the same journal's proof and cursor without duplicates, and durable quarantine;
- a journal fault after commit, and publication/archival failures before and
  after the public export;
- real backoff, abort, SIGTERM and forced timeout, with finite exhaustion;
- spawn and diagnostic redaction;
- actual CLI incidents, and lease exclusion and reuse.

**The repo part of H2b2 was complete. The H2 operational gate as a whole is not
closed:** no service was installed, and neither the team's host/process manager
nor a live deployment was checked. A SIGKILL of the parent itself cannot stop a
surviving child: the environment's manager must check and stop the whole tree,
and the child keeps holding the journal lease. This limit, Windows/power-loss
acceptance, disk budgeting/incident retention and external alerts need their own
owner and environment. Detailed start/stop/reconciliation:
[runbook ADR-042](tripwire-operations.md#bounded-observer-supervision-and-local-incidents-adr-042).

## History: H2b1 — failures while observing

Starting point: `92d36c7`, pushed and checked on GitHub. Removed a legacy catch
that retried unknown global errors as an RPC outage, and a source-adapter bug
that hid a proof write failure behind a per-payment unavailable.

Every proof, quarantine, discovery and watcher-health read or write on the
keyless observer's path now has a local journal boundary. Even a transport-shaped
error inside that boundary is a terminal `journal` failure, not an RPC retry.
Confirmations and positions written before the failure are kept and read by the
next run.

These stop the watch with an empty failure report:
- unknown global errors;
- invalid configuration or scope, and capacity;
- malformed or contradictory global evidence;
- deployment or runtime changes.

Only recognized temporary RPC failures and an explicitly checked lag of the
finalized head (`rpc-behind`) retry. The latter does not reset positions.

An inconsistent finalized customer-policy snapshot goes into durable quarantine;
a failed quarantine write gives a journal stop, not a claim of successful
quarantine. A known journal failure is not hidden by a simultaneous cancellation.
An ordinary SIGINT/SIGTERM cancellation stays clean. Missing or corrupt data for
one payment can still give HOLD/unavailable without proof or ALLOW. That is a
separate safe result, not a claim that the payment is healthy. A scan result of
`ok` does not mean every row is verified or that the process is running now.

The CLI keeps the exact running reason in a fixed stderr JSON diagnostic:
- 75: `rpc-unavailable`/`rpc-behind`;
- 78: journal, evidence, configuration, scope, capacity, quarantine or deployment;
- 70: internal;
- 74: publication.

Contracts, review/manifest/report formats and the SQLite schema did not change.
The shared failure types live in `scripts/tripwire/auditFailure.ts`; the old
`testnet/cctpAuditFailure.ts` is only a re-export for compatibility.

Checks: **1,363 tests / 67 files**, including **32 new** cases; build/typechecks
and lint passed. Fault fixtures check:
- failures before and after the proof, discovery and quarantine commits;
- a late proof read, and a same-journal restart without repeated claims;
- malformed and unknown global failures;
- typed outage, recovery and lag;
- per-payment HOLD and a finalized policy conflict;
- cancellation/cleanup, and exact one-shot running exits.

Two new signing-operator fixture cases also check that a journal failure before
or after the proof commit:
- passes through the Watcher without becoming a HOLD;
- stops the tick before signature, outbox or publication;
- lets a same-journal restart continue the original queue.

All chain data was synthetic.

## History: H2a — why the keyless observer exits

Starting point: `cc13777`, pushed to GitHub. Before this the CLI gave a generic
exit 1: a supervisor could not tell a temporary startup RPC failure from a
configuration or journal failure.

Now `observeCctp.ts` emits a fixed JSON diagnostic on stderr and a distinct exit
code:
- 75 only for a recognized temporary RPC failure inside the marked startup
  network boundary: a timeout, a transport error without an HTTP status,
  408/429/5xx, or a typed RPC limit;
- no automatic restart for a wrong network or HTTP URL, contract, runtime,
  journal or quarantine;
- 74 for save or archive errors;
- 70 for an unknown startup exception, not an assumed network failure.

Reasons, codes and limits are in the
[operations runbook](tripwire-operations.md#observer-process-exit-contract-adr-040).
Raw errors and causes stay inside the process and never reach this diagnostic.
Startup acceptance still happens before the journal opens. If the canonical
startup recheck fails after opening, the lease is released. Committed discovery
survives a publication failure and is read by the next run. A change to the
checked deployment or runtime during watch stops polling.

Checks: **1,331 tests / 66 files**, including **37 new** fixture-based cases and a
real subprocess CLI run for a terminal configuration error; build/typechecks and
lint passed. Environment: Node 24.19.0, npm 11.17.0. All new chain data was
synthetic.

## Remaining gates

| Step | Status / what it needs |
| :--- | :--- |
| H1 | Automated real-browser run (12/12, synthetic) done 2026-10-09; the native directory dialog and permission revocation still need a human smoke |
| H2a | Implemented and checked locally; startup/exit taxonomy |
| H2b1 | Implemented: runtime failure classification; journal failures are never retried |
| H2b2 | Repo supervisor, crash drills and local incidents implemented; host/service/process-tree/live acceptance open |
| H3 | Open: a designated person with test accounts, funding, and real finalized deployment/burn/mint/payout/return receipts. The guardian must be policy v4 (ADR-046) |
| H4 | H4a model, H4b report/viewer, H4c1 design and H4c2 pure verifier done; next H4c3 coordinated integration; execution separation open |
| H5 | Audit package prepared ([tripwire-audit-package.md](tripwire-audit-package.md)); vendor, pinned commit and independent audit open |
| H6 | Open: discovery owner, interviews and a real design-partner commitment |

A new clone has no `.tripwire` packages, keys or journals. Do not treat the old
funding snapshot as a current balance; do not regenerate an existing intent or
journal to get around an error. The payment escrow remains undeployed according
to the recorded evidence.

## Rule for the next agent

Check the branch, the working tree and the remote; read AGENTS, the handoff and
this checkpoint. Finish one verifiable step at a time. In each step update this
file (what was done, what was checked, the exact limits, the next acceptance
gate), the roadmap and the affected runbook; then commit and push to your own
branch and open a PR into `main`. After pushing, compare the full local SHA with
the remote SHA. No force push, and do not include someone else's unfinished
changes. This list records development facts, not a live service, a completed
testnet pilot or an audit.
