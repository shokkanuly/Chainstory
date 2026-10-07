# Read-only testnet operations viewer

Implemented 2026-10-06, ADR-026. Open `/tripwire/operations` through the link on
the incident replay. The page inspects public JSON snapshots. It does not connect
a wallet, call a transaction sender, sign, approve, request a return or query live
payment status from a chain. ADR-031 adds local public-folder refresh below. A validated file is **not** independently authenticated evidence.

## Before deployment

Generate a fresh keyless report:

```sh
npm run tripwire:cctp:preflight -- payment-config.json new-readiness.json
```

Import that JSON. The viewer shows source USDC, per-network ETH balances/roles,
funding blockers, predicted contract addresses, snapshot blocks and remaining
pilot gates. Predicted addresses are explicitly pending deployment. Even passed
funding checks do not establish deployment acceptance or sufficient gas for all
future actions. It does not show fabricated payments when the report lists none.

## After deployment

With accepted deployment, actual manifest-v3 proof locators and the existing
standalone keyless observer, export one public snapshot into a new file:

```sh
npm run tripwire:cctp:observe -- manifest.json observer.sqlite --report=new-payments.json
```

The report includes explicit manifest/deployment scope and, for currently verified
customer backing only, a public projection of the existing stored proof: source
and destination receipt hashes/block anchors, operation ID, source-intent policy
hash and fixed return recipient. Cached proof is not exported as current evidence
when receipt verification is unavailable. No signing keys enter the report.
`--report` cannot be combined with `--watch`, repeated or empty; files are created
exclusively and never overwritten. Existing streaming observer behavior remains
available without this flag. Startup failure before a snapshot produces no file;
poll failures can produce an unavailable/quarantined snapshot.

Use a separate observer journal, as in the [operator runbook](tripwire-payment-operator.md).
Do not delete or change scope to clear a quarantine. Import the new report to see
listed payments, search by address/payment/operation ID, filter states, and expand
reasons, policy versions, operation/recipient/return data and reported burn/mint
receipt links. Links are derived from supported testnet explorer configuration,
never arbitrary imported URLs. A mint receipt is not a payout receipt.

Rejected funded credit remains distinct from returned credit. A return request
and its maturity are separate from a confirmed return. Maturity is displayed from
the recorded chain state; a local clock never advances a payment to paid/returned.
HOLD, unavailable input or rejection creates no browser execution permission.
The observer still supplies no behavioral ALLOW; policy separation is pending.

## Receipt-backed listed-credit timeline (ADR-027)

Fresh observer reports optionally include `lifecycle` version 1 per currently
verified customer credit. Read canonical source burn and destination mint block
times from the authenticated proof anchors. For a return request or terminal
state, scan the compiled payment contract's `ReturnRequested`, `ReleaseExecuted`
and `CreditReturned` events from mint inclusion through the common finalized head.
Use 2,000-block pages, at most 128,000 blocks inclusive and 1,000 selected logs per
payment. Older history beyond that bound is explicitly unavailable; no unbounded
RPC scan or guessed terminal hash. The public reader filters the exact payment ID.

Validate each selected event against its successful receipt, exact contract/ID,
amount and payout/fixed-return recipient, non-removed unique log position, block
anchor, finalized range and monotonic destination clock. Check inclusion and
provenance of every receipt log; detect omitted same-payment events in a selected
receipt. Return request maturity must equal its block timestamp plus immutable
recovery delay and the current credit's returnAt. A return cannot precede maturity
or its request. Recheck all claimed block hashes/clocks after receipt reads;
authenticated backing conflicts propagate into the existing quarantine path.
RPC honesty/completeness remains a trust assumption, not consensus verification.

Terminal getter state alone cannot supply a payout/return transaction or duration.
Missing/inconsistent current history yields `lifecycle.status=unavailable`; no
cached completion is substituted. Existing verified backing and reported getter
state remain distinguishable from this independent history failure. Older
reports without the optional field remain readable with an explicit missing-data
message. The browser cross-checks lifecycle anchors/order/clock/maturity/outcome
against the report's proof, finalized head and payment state, but does not
authenticate the file or query receipts itself.

Expanded payments show burn, funded escrow, optional customer return request and
actual payout/return milestones with trusted testnet explorer links. Derive
exact bigint seconds separately for burn inclusion → mint inclusion, and mint
inclusion → terminal inclusion (or finalized snapshot for still-outstanding
credit, including rejection). Reverse cross-chain clocks suppress settlement
duration instead of clamping or taking an absolute difference. These are block
inclusion intervals: they do not measure finality waiting, first risk assessment,
review/acknowledgement time or operator response latency. They cover listed,
already authenticated credits, not burned-but-unminted transfers or treasury-wide
exposure. No milestone advances solely because the user's wall clock moves.

## Automatic operation discovery (ADR-028)

For an empty customer manifest v3, the existing keyless observer can build proof
locators automatically instead of requiring manual transaction hash pairing:

```sh
npm run tripwire:cctp:observe -- empty-manifest.json observer.sqlite --discover=SOURCE_START_BLOCK:DESTINATION_START_BLOCK --report=new-discovered-payments.json
```

Replace both start-block placeholders with actual decimal block numbers. Each
range ends at its independently captured finalized head and must contain 1–4,096
blocks. Start from the source payment/deployment evidence or a deliberately
selected recent interval; record omitted earlier history. This is a bounded
one-shot observation: `--discover` cannot be repeated or combined with `--watch`,
legacy manifests or existing manual requests. Runtime/binding acceptance occurs
before scanning; the subsequent audit rechecks current deployment/state.

Reuse the existing finalized `ContractEventFeed` with an optional upper bound,
64-block pages, linked canonical headers, unique non-removed event provenance and
stable range anchors. Adding a read bound does not change old execution checkpoints
or advance them on failed pages. Its RPC boundary now uses a small structural
reader interface rather than assuming identical viem transaction types for both
chains; legacy instant-demo input also receives schema validation.

Scan supported `MessageSent` payment hooks on the configured source transmitter
and `PaymentCreditBound` on the accepted destination escrow. Match the committed
operation ID, fixed return beneficiary and intent-policy hash. Build original
source log index/hash and destination mint hash as hints only. Every candidate
still passes the existing complete source/deposit/mint/credit receipt verifier;
matching events never authorize payment or establish authenticated backing. No
Circle API, new protocol format, dependency, sender or private key is introduced.

Multiple source/destination hints for an operation are ambiguous and are never
arbitrarily paired. Preserve unmatched destination hints with reasons and source
hints with no match in the scanned destination interval. A source-only hint is
not proof of an unminted balance: its missing match could be outside the range,
unsupported, absent or unavailable. Limit each side to 100 candidate events;
failed/lagging/malformed/inconsistent ranges produce no partial successful
report. Stop sibling scans on failure, honor cancellation, and recheck both range
anchors after the receipt audit. A changed committed finalized scan anchor uses
the observer's persistent quarantine path.

The public report's optional `discovery` version 1 records exact coverage,
candidate/paired counts, pending source hints, unmatched destination hints and
conflicting operation IDs. The viewer validates ranges, counts, proof bounds and
relationships to audited rows; it displays gaps separately with trusted explorer
links. Metrics for audited payments do not include unmatched hints as confirmed
funds. Missing older history and a zero-row interval never establish zero treasury
exposure. Existing manual observer/operator workflows remain supported.

## Persistent discovery and restart recovery (ADR-029)

For the same empty manifest v3, opt into a durable hint index:

```sh
npm run tripwire:cctp:observe -- empty-manifest.json observer.sqlite --discover-resume=SOURCE_START_BLOCK:DESTINATION_START_BLOCK --report=new-resumed-payments.json
```

Use the same state file, manifest bindings and original decimal start blocks on
subsequent runs; choose a new export filename. The observer fingerprints the
normalized empty manifest and refuses changed bindings or initial bounds. Existing
`--discover` remains a bounded one-shot search without this index. Both discovery
flags are mutually exclusive; only `--discover-resume` also supports `--watch`
through the continuous observer below.
Signing operator/manual locator workflows remain unchanged.

The existing deployment-scoped SQLite store and exclusive process lease now keep
one separately versioned `discovery` row. It contains BOTH finalized feed
checkpoints, cumulative covered ranges and all source/destination hints. JSON
bigint values, header/checkpoint agreement, provenance, event/contract scope,
unique log positions and consistent block/transaction identities are validated
before use. This is a local operator journal, never a browser/backend database or
an authenticated proof cache. Optional index schema v1 does not migrate/reset
existing SQLite schema-v3 proof claims or signed work.

Before resuming, recheck both committed anchors and every retained hint block,
including source-only operations and idle networks. Restore the original feed
checkpoint and scan from its next block. Limit each run to 4,096 new blocks per
chain using existing 64-block linked-header pages. A longer finalized backlog is
processed in consecutive runs without skipping blocks; report both covered
endpoints and captured finalized tips. Cumulative history may exceed 4,096 blocks.
A network with no new finalized blocks performs canonical rechecks without
replaying event queries. Initial omitted history remains omitted and explicit.

Source-only and destination-only hints persist and can match across runs. A later
duplicate operation remains ambiguous across restarts; no arbitrary pairing or
silent deletion is allowed. Every paired candidate undergoes the full existing
receipt/deployment/payment-state audit on EVERY run, including an idle restart.
Unavailable current receipts suppress reported authenticated proof even when a
previous proof claim exists. Search hints do not establish an unminted balance.

After scanning and auditing, recheck captured covered/tip hashes and clocks plus
retained history. Commit both cursors and hints atomically, then export. Errors or
cancellation before commit leave the old index intact; a crash before commit
replays the range. If export fails after commit, repeat the same command with a
new filename: the committed index persists and receipts are audited again.
Current receipt-unavailable/invalid rows may be reported and indexed as hints;
they never become cached approval evidence. A finalized-history conflict persists
quarantine through the existing observer path; a quarantined journal cannot
advance. Do not delete/change filenames to bypass quarantine or retained claims.

Retain at most 100 hints per chain for this bounded pilot. Capacity failure does
not advance cursors or silently prune terminal/pending/conflicting operations.
Larger retention, archival and operator reconciliation need a separate design;
this is not an unlimited production indexer. Changed bindings/starts also need
explicit reconciliation rather than an automatic journal reset.

Public optional `discovery` version 2 uses `persistent-finalized-hints`, retains
cumulative coverage/counts/gaps, and adds `incremental`: whether this is a resume,
each new scan start and both captured finalized tip headers. The viewer validates
new windows, idle boundaries, tip/covered-header relationships and destination
alignment with the audit snapshot. It shows newly searched blocks and exact
bigint remaining-block counts separately from accumulated coverage. A backlog is
also an explicit observer blocker. Imports remain unauthenticated display files.
Automatic signing, source-only accounting and complete treasury exposure remain
separate work. ADR-031 adds browser polling of public local files below.

## Continuous keyless observer (ADR-030)

After product deployment acceptance, start a foreground worker process:

```sh
npm run tripwire:cctp:observe -- empty-manifest.json observer.sqlite --discover-resume=SOURCE_START_BLOCK:DESTINATION_START_BLOCK --watch --interval=10 --reports=public-reports
```

Use the same empty manifest, scoped SQLite file and original start blocks as a
one-shot persistent search. The new combination extends the existing CLI, not a
second polling service. `--discover` remains one-shot; `--report=new.json` is
one-shot only. Optional `--reports=directory` requires watch mode. Each completed
watch attempt emits one NDJSON record; when a report directory is supplied it also
creates a distinct public JSON snapshot. Keep stdout suitable for a local process
supervisor; provider errors/URLs/keys are never included in public failure reasons.

The CLI accepts product runtime/bindings and opens the existing exclusive journal
lease BEFORE starting its loop. Startup failure, missing contracts, wrong scope,
quarantine or an already-owned journal exits without entering polling. Startup
RPC outages require a process restart; automatic retries apply after acceptance.
ADR-033 below classifies startup exits for a future supervisor; no supervisor is
installed. ADR-034 below closes the generic running retry path; supervisor/crash
drills and local incident monitoring remain H2b2.
The CLI owns the lease and releases it in `finally`, including cancellation,
terminal observation failure and publication failure. No daemon installation,
OS supervisor, hosted API, alert delivery or background Codex automation is added.

Run the existing audit/discovery logic through one tested sequential worker.
Complete discovery, fresh receipt/state audit, canonical rechecks, atomic index
commit and snapshot publication before scheduling another tick. Wait the chosen
5–300 second interval AFTER the previous tick/export finishes; slow checks do not
overlap, accumulate timers or start concurrent scans. Every idle tick still
rechecks saved history and current receipts. Long backlogs are consumed in
consecutive scheduled increments of at most 4,096 new blocks per chain, without
cursor jumps. Per-payment unavailable evidence stays unavailable in a successful
scan report; the next regular check retries its receipt/state reads.

On a recognized temporary RPC failure or validated behind-head condition, publish a new unavailable snapshot with
no payment rows. Retain the last committed index, retry after the configured
interval, then double the delay for consecutive failures up to 300 seconds.
A successful scan resets the failure counter and returns to the normal interval.
A lagging finalized head behind committed history is retryable; do not reset its
cursor. Operation ambiguity is reported with explicit gaps while other candidates
are audited; it never chooses a duplicate automatically.

Stop, publish a terminal failure and require reconciliation for changed/malformed
manifest scope, wrong chain/initial bounds, unreadable/failed journal updates or
100-retained-hints-per-chain capacity exhaustion. The discovery reader preserves
the first failure when sibling scans cancel, so a capacity/finality error cannot
be disguised as a transient cancellation. A changed finalized receipt/history or
captured discovery snapshot persists quarantine and stops retries. Restarts cannot
clear quarantine. Manual watch mode may reload request locators, but its deployment
and immutable customer scope remain fixed. Mutable customer policy is reread.

SIGINT/SIGTERM cancel RPC via the shared AbortSignal and wake scheduled waits.
The worker starts no new tick and emits no partial success after cancellation.
Canonical source claims already committed during an audit remain immutable; no
rollback, wallet action or funds movement is implied. A successful index commit
can precede an export failure; in that case exit, fix publication, and restart
against the SAME journal to audit again. Never treat disk errors as RPC retries.

Public exports use an exclusive same-directory temporary file, mode 0600, flush
it, and publish with an atomic non-overwriting hard link. Failed writes remove
only their own temporary file. A crash can leave `.partial-*` files; completed
public reports are the `.json` filenames. Neither existing snapshots nor journals
are replaced/deleted. New report directories use mode 0700; existing directory
permissions are the caller's responsibility. Export requires a filesystem with
hard-link support. Without `--keep-reports`, snapshots continue to accumulate without automatic
archival/deletion. ADR-032 adds reversible public-file archival below; total disk
usage still grows and requires operator planning.

Watch reports add optional public `worker` schema v1: process-local attempt,
consecutive failure count, configured interval, planned next delay and
`scheduled`/`retrying`/`stopped` state. These counters reset when a new process
starts; SQLite search cursors and proof claims persist. The viewer validates
state/count/delay relationships and consistency with success/unavailable/quarantine.
It displays the schedule AS REPORTED AT CAPTURE. An imported file does not follow
process health live, promise a future tick or independently prove liveness. Stale
and failed imports cannot preserve previous payment rows as current evidence.

## Automatic local report-folder updates (ADR-031)

On `/tripwire/operations`, choose **Follow public report folder**, then select the
separate public directory used by `--watch --reports=public-reports`. Choose a
folder containing ONLY public observer snapshots, not a wallet/config/journal
folder. The native directory picker requests **read** access only and requires a
button click. Availability depends on a supporting browser and secure context;
unsupported browsers show a disabled folder control and retain manual import.
See [the browser API and permission model](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).

While the page remains open, enumerate the selected directory and read the newest
completed `observation-TIMESTAMP-UUID.json` body. Do not recurse into subfolders,
open unrelated files, read `.partial-*` publications or send files to a server.
Select the greatest numeric publication timestamp, not enumeration order or a
UUID tie-break. If the newest timestamps tie, clear the snapshot and await a later
publication. Filename order is a publisher convention, not authenticated evidence.

Finish each read before waiting five seconds for the next check; slow reads do
not overlap. Browser background throttling can delay checks. Read at most 2,000
entries and one report body per pass, with the existing 2 MB/schema/1,000-row
boundary. At capacity, clear displayed data and require a smaller public directory;
the browser performs no archival/deletion. The optional standalone observer
archival below keeps that top level bounded during normal operation. Retain only current report text and
continuity metadata in page memory. Reload/navigation, manual import, clear or
**Disconnect folder** cancels queued work and suppresses late reads; reconnect
explicitly after reload. Handles are not stored in IndexedDB/localStorage.

A new unavailable/quarantined report replaces the whole payment snapshot, including
old rows, coverage and receipt anchors. A malformed/oversized latest file, missing
latest file, native read/permission failure or backwards publication/capture clock
clears previous data instead of falling back to an older success. Remember the
newest filename even when validation fails, so deleting that invalid file cannot
bring back old successful statuses. Folder checks continue and can recover on a
later valid report. Redact native error details/paths. Never update report capture
time just because the folder was checked; existing stale/future flags remain.

Pin the first successful report's validated manifest-version/vault/guardian/operator
scope and synthetic marker for that connection; refuse a changed successful scope.
Failure envelopes contain no deployment scope and remain unauthenticated. They
clear rows but cannot change the pinned successful scope. Use a dedicated directory
per observer deployment; reconnect deliberately when changing scope or resolving
clock/publication-order issues. Neither folder permission, recent exports nor a
scheduled worker field proves process liveness or authorizes a payment.

The browser source controller lives next to its page and imports generic domain
snapshot types; existing EVM schema parsing stays in `src/chains/evm/operations.ts`.
This follows the existing `src/pages` UI layout rather than introducing `src/app`.
No filesystem writer, database access, HTTP endpoint, dependency or signer is added.

## Bounded archival of public reports (ADR-032)

For extended local observation, add `--keep-reports=500` to the existing watch
command:

```sh
npm run tripwire:cctp:observe -- empty-manifest.json observer.sqlite --discover-resume=SOURCE_START_BLOCK:DESTINATION_START_BLOCK --watch --interval=10 --reports=public-reports --keep-reports=500
```

The flag requires watch directory output and a canonical integer from 10 through
1,000. It is optional: omitting it preserves append-only top-level publication.
Use a dedicated public directory owned by one observer writer. It must be a real
directory, not a symlink. New public/archive directories use mode 0700; existing
permissions remain the operator's responsibility. The browser needs read access
only; archival runs in the standalone local process, never in browser/proxies.

After successfully publishing the new complete JSON file, enumerate up to 10,000
top-level entries. Validate candidate names through the same pure bigint timestamp
codec as the browser. Open no JSON bodies, unrelated/private/configuration/journal
files or subdirectories. Refuse report-shaped symlinks or directories. Keep the
newest requested number by numeric publication time, all files tied at its boundary,
and the just-published file even if the local clock rolled backwards. Never make
an ambiguous newest group look unique by archiving its peers. If these exceptions
would retain more than 1,001 files, stop for publication reconciliation.

Plan older completed reports into the `archive/` subdirectory. Check every planned
name collision before moving any file: an existing different inode is a conflict,
even if its bytes happen to match. Refuse an archive path that is a symlink or a
file. Recheck source identity/size/modification time before changing links. Create
an exclusive same-filesystem hard link, verify its identity, flush the file and
archive directory, then remove only the original top-level link and flush that
directory. No archive entry is overwritten and no report data is intentionally
purged. A crash/failure may leave both copies; a retry recognizes only the same
inode and safely finishes that move. Concurrent local directory tampering is
outside the dedicated single-writer assumption.

Move at most 100 files per completed observation. Existing backlog is processed
in consecutive ticks; an initially oversized folder can take several ticks to
fall below the browser's 2,000-entry limit. In normal operation, one new report
requires at most one older move. Synchronous local filesystem work can delay the
next tick; the worker still does not overlap checks. The helper reports moved,
retained and remaining candidate counts locally without altering observer evidence.
Total archive storage remains unbounded: this is reversible organization, not
space reclamation, encryption or a tamper-evident evidence store. Directory flush
and hard-link support are required; real filesystem checks here ran on macOS.

A publication can succeed before archival fails. Such a failure stops the worker
through the existing publication failure path, instead of retrying it as an RPC
outage or sending a transaction. Already moved reports stay archived, the new
report remains readable, and committed discovery/proof claims remain intact.
Fix the local storage conflict and restart with the SAME journal/manifest/initial
blocks. Do not reset quarantine or proof history. A captured `scheduled` worker
field cannot certify that the process survived its later archive step.

The browser continues to inspect the newest top-level snapshot and does not
recurse into the archive. Inspect an archived public report by manual import;
never copy old files back to the top level to manufacture a fresh status. Native
folder selection/refresh end-to-end remains unverified by automation as recorded
under ADR-031. The discovery journal's 100-hints-per-chain cap is unchanged.

## Observer process exit contract (ADR-033)

H2a extends the existing standalone CLI; it does not install a daemon or change
manifest/review/journal/public report formats. Stdout remains public observation
NDJSON (or the existing one-shot file mode). Failed process exit emits a fixed
version-1 JSON object on stderr, never a raw exception, RPC URL, local path or
stack trace. It contains `mode: observe`, `enforcement: false`, `phase`
(`startup`, `running`, `cleanup`), a reason and `restartable`.

| Exit | Diagnostic reason | Operational response |
| :--- | :--- | :--- |
| 0 | No failure diagnostic | One-shot completed or signal cancellation completed; not proof of a healthy long-running service |
| 75 | `rpc-unavailable` | Recognized temporary RPC exception at a marked audit boundary; future supervisor may retry with bounded backoff |
| 78 | `configuration`, `deployment`, `journal`, `quarantine`, `observation-stopped` | Stop and reconcile; no automatic restart to bypass scope/runtime/capacity/storage/quarantine guards |
| 74 | `publication` | Local public output or archival failed; inspect storage, keep the same journal, then explicitly retry |
| 70 | `internal`, `observation-unavailable` | Unclassified failure or unsuccessful one-shot audit; inspect before restart, do not assume RPC outage |

ADR-034 extends exit 75 with explicitly validated `rpc-behind` and exit 78 with
`scope`, `capacity`, `evidence`. Running failures now preserve their exact reason
instead of collapsing to `observation-stopped`/`observation-unavailable`.

Example terminal diagnostic (fixed structure, not a live incident):

```json
{"version":1,"mode":"observe","enforcement":false,"phase":"startup","reason":"deployment","restartable":false}
```

Only recognized viem HTTP transport failures without status, status 408/429/5xx,
TimeoutError or LimitExceededRpcError make a marked **network** boundary retryable.
Follow at most twelve error causes, reject cycles, and refuse denied/non-transient
HTTP statuses even with an inner timeout. No substring/class-name impersonation
is accepted. Unknown causes fail conservatively. Startup HTTP(S) URL syntax is
validated before creating clients; HTTP 400/401/403/404 and wrong chain identity
are not claimed to be temporary outages. Raw causes are retained internally for
typed control flow/compatibility and must never be logged by added tooling.

Manifest/client configuration, initial deployment acceptance and journal opening
are classified separately. Missing/wrong runtime refuses before SQLite creation.
A startup canonical RPC failure after opening state closes the lease; a new
command can reuse the original journal. Existing persistent quarantine stays
terminal across restarts. A finalized conflict detected before a journal exists
is reported as quarantine/reconciliation but cannot persist a marker in a journal
that was never opened. Runtime acceptance failure inside watch stops the worker;
it no longer endlessly polls a mismatched deployment. A partial publication/archive
failure can follow committed proof/index state and a visible report; preserve both.

**Historical H2a boundary, superseded by ADR-034:** H2a initially left the running
catch/backoff for untyped audit/discovery exceptions in place. ADR-034 below now
separates those from local journal failures and unknown global exceptions. Process
supervision/crash drills and local incidents remain H2b2, described in
[the current checkpoint](tripwire-progress.md). Do not delete journals, reset
quarantine, change scope or regenerate intents to obtain a restartable result.

For future supervision, invoke the Node entrypoint directly (with the repository's
existing tsx dependency) so the child exit code is observable:

```sh
node --import tsx scripts/tripwire/testnet/observeCctp.ts empty-manifest.json observer.sqlite --discover-resume=SOURCE_START_BLOCK:DESTINATION_START_BLOCK --watch --interval=10 --reports=public-reports --keep-reports=500
```

Use actual bounds and the accepted empty manifest. This is an invocation example,
not a supervisor installation; rate limiting, crash policy and local incidents
remain required. Startup diagnostics contain no observed/capture timestamp and
must not be interpreted as a fresh operations snapshot.

Evidence: 1,331 tests / 66 files, build/typechecks and lint pass. The 37 new cases
cover startup input/URL/chain/runtime/RPC/journal/quarantine, bounded typed cause
classification and redaction, same-journal lease recovery, runtime stop, committed
publication failure recovery, cancellation and a real CLI subprocess exit 78.
All chain data is synthetic. No live deployment/payment/key read/audit occurred.

## Observer running failure contract (ADR-034)

H2b1 removes the catch-all global retry in the existing keyless worker. Retry only
typed temporary RPC failure from a marked network boundary, or an explicitly
validated finalized head behind a saved cursor/proof/state minimum. Both publish
an empty unavailable report and retain capped in-process backoff. Head lag does
not reset journal history. Unknown global errors stop as `internal` (exit 70),
not an assumed outage; invalid global/provider evidence stops as `evidence` (78).
Manifest/scope/capacity/deployment/runtime/quarantine remain terminal (78).
Failure reason text is an allowlisted catalog; native/underlying error messages
never enter public reports or stderr diagnostics.

All observer-path journal health/proof/discovery/quarantine reads and writes use
a separate local boundary. A disk, schema, semantic journal guard or read/write
failure is `journal` (78), even if its cause looks like HttpRequestError or timeout.
Source authentication now propagates proof persistence failure, instead of
returning per-payment unavailable and continuing. This also applies to the shared
source adapter used by the signing operator; no execution policy is relaxed.
Source adapter internals and audit/worker share one failure implementation under
`scripts/tripwire/auditFailure.ts`; the earlier testnet import path re-exports it.

After a terminal running failure, export a fresh empty unavailable/stopped report
if storage permits, with no old payment rows or proof projection. A finalized
conflict persists quarantine; if the quarantine write fails, report journal stop
without claiming its persistence. A write may commit before reporting failure:
proof/index/quarantine already present remains immutable. Explicit restart after
reconciliation uses the SAME journal/manifest/bounds, does not repeat claims, and
still refuses a committed quarantine. A finalized policy snapshot that changes
hash/clock mid-read now follows the conflict/quarantine path; latest signing
snapshots retain their existing refusal behavior.

Per-payment missing/malformed receipts or release reads remain HOLD/unavailable
without current proof or ALLOW; other candidates can still be observed. A scan
report `ok` therefore says the scan completed, not that all listed credits are
verified, paid, or that the worker is still alive. Contradictory customer-policy
state and malformed global discovery headers/events stop the whole observation.
These separate boundaries must be preserved by future monitoring.

Known terminal journal errors are not suppressed by simultaneous cancellation.
Ordinary signal cancellation remains clean and emits no partial success. CLI
cleanup failure remains terminal journal, even if database/lease closure already
completed. No SQLite/public report/manifest/signature format change or migration
is introduced. Report/archive publication failure keeps exit 74 and its existing
after-commit recovery semantics.

Validation: **1,363 tests / 67 files**, including 32 new fault fixtures; build,
typechecks and lint pass. Tests cover transport-shaped local failures, proof/index/
quarantine failure before/after commit, late proof projection failure, same-journal
restart, malformed/unknown global evidence, typed outage/recovery/lag, per-payment
HOLD, finalized policy conflict, cancellation/cleanup, and exact one-shot running
exit reasons. Two signing-operator cases also confirm journal fault propagation
through Watcher before signature/outbox/publication, then original-queue restart.
Existing outage fixtures now model actual typed HTTP 503 rather
than a plain Error that merely says offline. Shared signing tests also pass.
All chain evidence is synthetic. No supervisor was installed, no key was read,
and no public payment/deployment/audit occurred. H2b2 is repo process supervision,
real child crash/restart drills and local incidents; see [checkpoint](tripwire-progress.md).

## File and freshness boundary

Only version-1 keyless preflight and current manifest-v3 customer-payment observe
reports are supported. Legacy/audit/enforcement-enabled reports are refused.
Maximum input is 2 MB / 1,000 payment rows. Canonical decimal strings become
bigint; numeric/floating/negative/overflow amounts are refused. Validate chain,
route, scope, IDs, declared row counts, proof/net-credit consistency, policy/return
state, receipt blocks and common payment clock. Unknown fields are discarded;
bounded prose is rendered as text with control/bidi characters removed.

Report content remains in page memory and is cleared on navigation/reload or the
clear button. There is no new server, upload endpoint, persistence or analytics.
Importing a replacement first removes the previous snapshot; failed input does
not leave old statuses displayed. A generation counter prevents an earlier slow
file read from replacing a later selection. Reports older than five minutes or
with a clock more than two minutes ahead are visibly flagged; even a recent file
is a snapshot, not a live or authoritative execution decision. Listed requests
are not a complete treasury inventory; metrics count listed rows only.

`src/testing/fixtures/tripwire/operations-synthetic.json` is an explicitly marked
example for inspecting UI states. Its hashes/addresses are fabricated and it
establishes no public receipt or funding. Removing its marker does not authenticate
a file; all imports retain the unverified-snapshot notice.

## Bounded observer supervision and local incidents (ADR-035)

H2b2 is a repository foreground tool, tested with actual child processes and
synthetic chain vectors on local macOS. No service has been installed. It supervises
the keyless observer only; it cannot sign, deploy, relay or start the payment operator.
The original manifest, journal and public report formats remain unchanged.

### Configure and run

Use Node with `node:sqlite` and the installed lockfile dependencies. The tested
environment is Node 24.19.0 / npm 11.17.0. Create a private local configuration
outside Git, for example `.tripwire/observer-supervisor.json`:

```json
{
  "version": 1,
  "manifest": "pilot/payment-manifest.json",
  "journal": "pilot/observer.sqlite",
  "reports": "pilot/public-reports",
  "incidents": "pilot/observer-incidents",
  "intervalSeconds": 10,
  "keepReports": 500,
  "maxRestarts": 3,
  "restartOnCrash": false,
  "backoffSeconds": 10,
  "maxBackoffSeconds": 300,
  "stopGraceSeconds": 30,
  "checkSeconds": 5,
  "staleSeconds": 300
}
```

Paths resolve relative to this config file, not the current terminal directory.
The checked-in `scripts/tripwire/testnet/supervisor.example.json` uses paths relative
to its own repo location; edit paths if copying it elsewhere. The example does
not supply a deployed manifest in a fresh clone. Supply an accepted manifest v3;
leave its receipt locators intact. For empty-manifest persistent discovery add
`"discovery": "SOURCE_START:DESTINATION_START"`, replacing both placeholders with
the original decimal start blocks. Argument bounds come from the observer's
existing parser; changed starts/scope are still refused by the journal.

```sh
npm run tripwire:cctp:supervise -- .tripwire/observer-supervisor.json
```

For an external process manager use the direct entrypoint, preserving its exit:

```sh
node --import tsx scripts/tripwire/testnet/superviseCctp.ts .tripwire/observer-supervisor.json
```

The parent launches exactly `process.execPath --import tsx observeCctp.ts` with
structured arguments, no shell, using the repo's working directory. Child stdout
is discarded because reports already publish to the configured public directory.
Only RPC transport URLs and minimal OS/path/temp environment variables are passed
to the child; wallet variables, `HOME`, `NODE_OPTIONS`, `NODE_PATH` and unrelated
credentials are excluded. RPC URLs may contain credentials; they are never
included in incident output. Config accepts no arbitrary command or environment
block. Dedicated reports/incidents directories must be disjoint from each other
and the manifest/journal. One trusted local writer owns each real directory;
concurrent filesystem tampering or symlinked ancestors are outside this pilot's
filesystem assumption. The parent never reads signing keys or journal rows.

### Restart and stop contract

| Child outcome | Parent behavior |
| :--- | :--- |
| 0 | Finish with 0; no restart |
| 75 | Restart within the configured finite budget |
| SIGKILL / SIGABRT / SIGSEGV / SIGBUS | Restart only with explicit `restartOnCrash: true` and remaining budget; otherwise 78 |
| 70 / 74 / 78 or another numeric failure | Stop and preserve that exit; no automatic restart |
| SIGTERM / SIGINT / other unapproved signal | Stop with 78; no crash-policy restart |
| Spawn failure | Stop with 70 |
| Restart budget exhausted | Record `restart-exhausted`, stop with 78 |
| Parent incident-directory/lease failure | Refuse before launching with 78 |
| Incident publication failure while child runs | Send SIGTERM, wait for child closure, stop with 74; no restart |

`maxRestarts` is 0–10 additional launches, never reset by an individual child's
lifetime. Delay is `min(maxBackoffSeconds, backoffSeconds * 2^(restartNumber-1))`;
both delays are 1–300 seconds with initial ≤ maximum. Defaults permit three
additional launches at 10/20/40 seconds. Watch-mode RPC polls retain their own
existing capped backoff; the process restart budget does not limit in-process
polling. Do not wrap this tool in an unconditional outer restart policy: a fresh
supervisor invocation starts a fresh budget. Exhaustion and terminal exits need
manual reconciliation before another invocation.

Send SIGINT/SIGTERM to the supervisor, or stop it with Ctrl+C. It cancels pending
backoff, forwards SIGTERM to the current direct child, and waits for the child's
exit **and stdio closure**. Grace is 1–300 seconds, default 30. If exceeded, send
SIGKILL, record `stop-timeout`, return 78 and require reconciliation; do not
automatically treat forced shutdown as clean or restart it. A terminal child
exit during cancellation remains terminal. A clean observer cancellation returns
0. The separate `incidents/supervisor.lease` is an OS-released SQLite exclusive
transaction; never delete it or the observer lease to force a second process.

Before a manual restart verify that the old parent and child have exited. Reuse
the original manifest/journal/start blocks. Inspect fixed process incidents and
resolve provider/configuration/storage/publication causes. Quarantine remains
terminal; no tool here clears it. A proof/discovery commit or already published
report survives a later failure. Regenerate a public snapshot by a fresh current
audit, never undo a commit or send another transfer to hide a publication failure.

### Local incident records

Each event is an exclusively published `incident-<time>-<uuid>.json`, mode 0600,
in the dedicated private incident directory (new directory mode 0700), with
version 1, mode `supervise`, enforcement false, per-invocation `runId` and
`recordedAt`. The same fixed event is printed as NDJSON. Raw child stderr is
discarded; only a bounded strict observer diagnostic with a reason matching the
actual child exit may be retained. Numeric exit controls restart, never message
contents. Old incident records are preserved. Their total disk use grows; there
is no deletion/rotation or external alert delivery in this step. Do not choose
the incident directory in the browser's public-report picker.

Process events distinguish starting, exited, restart-scheduled/exhausted,
stopping/stop-timeout and spawn-failed. Report events record conditions and
recovery transitions, not every periodic check. Only validated capture time,
synthetic marker and fixed condition IDs are exported:

- `report-missing`, `report-access`, `report-invalid`;
- `report-stale`, `report-future`, `report-unavailable`, `report-retrying`,
  `report-stopped`, `report-quarantined`;
- `discovery-backlog`, `discovery-gaps`, `discovery-capacity` (100 retained hints).

No payment rows, addresses, body reasons, URL/path, error stack or raw cause is
copied. Capacity/storage/publication reasons also appear in actual child exit
events. Report selection checks only completed top-level names, up to 10,000
entries, maximum body 2 MB; reject symlink/nonregular bodies, newest timestamp
ties, invalid newest and deletion-based fallback. Reuse the existing public
adapter's schemas and pin successful deployment scope across the managed run.
Capture time comes from the report body; filename/check/incident time cannot
refresh it. Default stale threshold is 300 seconds (configurable 30–3600);
more than 120 seconds in the future is separately flagged. No report file is
modified by this monitoring.

Conditions are advisory. An empty condition list does not certify payments,
enforcement, complete treasury coverage or process liveness; process events are
separate. Imported reports remain unauthenticated, with the existing RPC/Circle
and accepted-runtime trust assumptions. A hanging child causes stale events,
not automatic killing/restarting based on old snapshots.

### Validation and remaining acceptance

**1,421 tests / 69 files** pass, with 58 new tests. Actual Node/tsx subprocesses
run the real audit/discovery/store/export path using serialized synthetic RPC
ports; fixtures are test-only and cannot be selected by the production CLI.
Checks cover startup outage, SIGKILL before/after publication, same-journal claims/
cursors, post-commit journal failure, persistent quarantine, before-publication
and after-publication archive failure, explicit crash policy, finite exponential
budget, real delay/cancel, graceful SIGTERM/lease reuse, forced timeout,
spawn/diagnostic redaction, actual CLI terminal exits/incidents and supervisor
lease exclusion/reuse. Monitor fixtures cover stale/future capture time,
retry/stopped/quarantine, backlog/capacity/gaps, bounds/nonregular input,
scope/timestamp/deletion refusal, partial/archive exclusion and recovery dedup.
Build/typechecks and lint pass. No public RPC/deployment/payment/key read or audit.

The team's host/service acceptance still needs a designated operator: dedicated
paths/permissions/disk budget, approved crash policy, pinned runtime/checkout,
outer process-manager behavior and real deployment evidence. Abrupt termination
of the **parent** (SIGKILL, host crash) cannot forward a signal to its child;
the host manager must stop/check the entire process tree. A surviving child keeps
its journal lease, so blindly starting another parent will refuse rather than
steal the lease. Parent-crash/process-tree management, Windows behavior, power-loss
durability and external notifications are not verified here. Repository checks
do not close the full operational/live pilot gate.

## Historical evidence and limits (ADR-032 snapshot)

1,294 tests / 65 files pass. Public archival adds 37 cases covering exact
retention/clock/tie/batch boundaries, preserved bytes/permissions, private/partial
file exclusion, symlink/collision/changed-file refusal, flush/link/unlink failure,
crash/retry, CLI opt-in and real observer export→archive→reader wiring. A real
2,001-file fixture drops below the viewer entry cap after a bounded batch; current
outage reports still clear old rows. A separate explicitly synthetic disk rehearsal
retained ten reports and archived two. The predeployment command with archival
opt-in refused before creating its SQLite journal, lease or report directory. Local folder refresh adds 28 fixture-based cases for
publication selection, partial/private/nested-file exclusion, outage/recovery,
invalid-newest/deletion/no-fallback behavior, immutable publication checks, scope
and clock continuity, bounds, native error redaction, sequential scheduling,
cancellation and read-only capability detection. Continuous observation adds 62 cases covering
sequential/idle/late-mint/backlog polling, outage backoff/reset, fresh receipt and
policy reads, terminal manifest/storage/capacity/finality stops, cancellation,
restart/publication failure, atomic files and public worker metadata. Durable
discovery adds 55 cases for restart/idle
recovery, late matching, bounded backlog, atomic failure/interruption, retained
ambiguity, scope/corruption/capacity/quarantine guards, current receipt outage
and public cumulative/increment/tip boundaries. Initial discovery adds 56 cases covering matching and
ambiguous/missing/unsupported operations, exact range paging, scope/limits,
cancellation, RPC/canonical failures, CLI restrictions, public coverage boundaries
and an end-to-end discovery→receipt audit→viewer round-trip. Lifecycle adds 60 cases covering synthetic own-ABI
receipts, missing/reverted/substituted/removed/duplicate events, bad recipients and
amounts, maturity, bounded history, canonical switches, cross-chain clocks,
unavailable current evidence and observer-to-viewer terminal round-trip. The
earlier viewer milestone added 46 file-boundary/serialization/cache cases
and an existing observer integration extended to round-trip its actual export
through the browser adapter. Browser checks cover actual public funding import,
synthetic state/filter/details, search, replacement refusal and narrow-layout
rendering. Lifecycle browser checks verify the returned-credit timeline, exact
intervals, explorer links and a separate unavailable-completion-history fixture.
Discovery browser checks use the explicitly synthetic coverage fixture, expand
unmatched/conflict details and confirm that only four paired rows enter the
payment queue. Live predeployment discovery startup refuses before creating its
observer journal or export file. The persistent mode also refuses predeployment
startup without creating its database, lease or export. The resumed synthetic
fixture verifies cumulative/new coverage separately in the browser. Continuous
worker examples show healthy scheduling and unavailable retry metadata; outage
imports replace previously loaded payment rows. The predeployment watch command
also exits without creating a database, lease or reports directory.
The folder picker was invoked in the actual in-app browser, but its native dialog
cannot be operated through the available automation. End-to-end folder selection
and filesystem refresh remain unverified in that browser; controller tests do not
replace that check. Manual browser import remains verified.
Build/typechecks and lint pass.

Actual keyless funding read at 2026-10-06 12:37:40 UTC still shows four blockers
(owner/oracle destination gas, source gas and source USDC). No new deployment,
burn/mint/payout/return, public transaction, key read or external audit occurred.
Expanded discovery retention, archive space reclamation, full lifecycle/finality/operator timing, aggregate exposure, hosted live data,
audited source controls, behavioral policy and design-partner validation remain
separate milestones. This page is a usable local operations viewer, not a hosted
payment service or proof of production readiness. Repo supervision/local incidents
were added later in ADR-035 above; live host/service acceptance and external alerts
remain pending.
