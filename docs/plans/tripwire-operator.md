# Tripwire durable operator — local implementation, 2026-09-30

The operator persists observations and outgoing transactions across crashes.
It runs separately from the read-only browser and stateless API proxies
([ADR-015](../07-decisions-adr.md#adr-015--durable-tripwire-operator-state-and-signed-transaction-outbox)).
The existing public Sepolia vault predates release reviews; this command requires
a deployment of the current gated vault. No deployment was performed in this milestone.

## Components and contract

| Component | Responsibility |
| :--- | :--- |
| `scripts/tripwire/store.ts` | Node's built-in SQLite, WAL/FULL, deployment/schema validation and one-process lease |
| `scripts/tripwire/watch.ts` | Checkpoint both feeds with ingested events before returning assessments; retain exact request history and conflicts |
| `scripts/tripwire/sender.ts` | Validate and save signed bytes before broadcast; reconcile receipts/rebroadcast the same transaction after restart |
| `scripts/tripwire/operator.ts` | Apply protection, review, retry holds/delays, acknowledge only confirmed terminal outcomes |
| `scripts/tripwire/attest.ts`, `testnet/guardianState.ts` | Reconcile chain-bound tier/expiry/oracle and refresh justified protection before expiry |
| `scripts/tripwire/testnet/operator.ts` | Sepolia RPC, local signing, gated-vault binding checks and durable guardian/review/execution sends |

Feeds expose `checkpoint()` and `restore(cursor)` in addition to `poll()`.
A durable watcher refuses a feed without those methods. Both cursors, burns,
pending releases, completed message IDs, conflicts and release history are stored
in one atomic snapshot; a failed ingestion rolls both feeds back to the prior range.
The standalone operator covers at most 64 finalized blocks per poll, verifying
every header and parent link (up to 8 concurrent lookups). The instant scripted
demo retains its 2,000-block cap. RPC/decode failure leaves the range retryable.
Amounts are bigint in memory and canonical decimal strings on disk. Behavioral USD
heuristics still use the existing approximate demo pricing; a real price/baseline
adapter is not part of this change.

Acknowledgement is asynchronous and serialized with polling. Callers must await it.
A HOLD review, a failed transaction or a guardian-delayed payout is not completion.
The durable runner only removes a request after matching on-chain EXECUTED or
REJECTED state at a hash-checked finalized block. On restart it checks durable
source/destination anchors before recovering signed work. Review/risk protection
may proceed after canonical inclusion so their short TTL remains usable.

## Run

Use Node 22.13 or newer (Node 24 recommended); no new npm packages are needed.
Configure `.env.tripwire` as for the existing Sepolia scripts and select the deployment
with `TRIPWIRE_DEPLOYMENT_FILE` if necessary. Use only a throwaway testnet key.

```bash
npm run tripwire:operator:sepolia              # one poll; no route reset
npm run tripwire:operator:sepolia -- --watch   # poll every 10 seconds
```

The default database is `.tripwire/sepolia-<vault-address>.sqlite`.
`TRIPWIRE_STATE_FILE` selects a different local path. Keep that path stable and
use one operator; the transaction sender must not be used concurrently by another
wallet/process. Changing deployment scope or sender requires an explicit migration,
not deleting the queue. A second process using the same state fails immediately;
SIGKILL releases its SQLite lease without manual stale-lock cleanup.

The CLI intentionally supplies neither an independent source verifier nor a live
baseline: unchecked releases stay pending/held. It does not manufacture burns or
resume/reset a route. It may submit HOLD to revoke an existing VERIFIED allowance,
and it recovers transactions already journaled by this operator. `createRpcOperator`
accepts explicit source-verifier, baseline and contract-facts adapters for integration;
those must be independently validated before allowing a real payout.

RPC/timeouts or disk errors stop the run with its queue preserved. Rerunning against
the same state reconciles the original transaction hash. No new nonce is allocated
while an earlier signed transaction has no known canonical inclusion. Already-known/nonce-too-low responses
alone do not prove success: the sender needs the original receipt. Reverted receipts
are stored and subsequent payout attempts require a new assessment/review.

Keep the database, WAL/SHM and lease together on a local filesystem. Do not rename,
delete or edit them while the operator runs. Files are ignored by Git; database and
lease are mode 0600. A signed raw transaction is authorization material even though
it contains no private key. Stop the operator before taking a SQLite backup; use
SQLite's backup API or checkpoint and copy the database with its sidecars.

## Verified and deferred

Tests include real child-process SIGKILL before/after SQLite commit, injected disk
and RPC errors, exact amounts above the float precision limit, restored pending
requests and conflicts, duplicate completion, original-byte retransmission, receipt
reconciliation and HOLD/delay recovery. The local EVM demo and existing vault tests
remain unchanged in behavior.

Ethereum/Sepolia finalized RPC observations and receipt reorg recovery are
implemented locally; the finality policy below remains provider-trusting. A real
bridge/source consensus adapter, live baselines,
gas replacement and queue compaction remain in the hardening plan. SQLite
snapshots are intended for a single-route pilot, not high-volume production.


## Finality and reorg policy (ADR-016)

The standalone operator uses the [`finalized` RPC block tag](https://ethereum.org/developers/docs/apis/json-rpc/).
It validates block number/hash/parent links and each log's contract, block hash,
transaction hash and log index. Checkpoints bind chain, contract, event, start block,
next block and committed anchor hash; events retain their exact origin on disk.
Unsupported finalized tags and lagging RPCs stop the run without advancing cursors.
There is no latest/block-count fallback. A selected real bridge or rollup still
needs its own source authentication and finality adapter.

| Journal state | Meaning | Operator behavior |
| :--- | :--- | :--- |
| `signed` | Bytes persisted, no accepted inclusion | Recover the same hash; block fresh nonce allocation |
| `included` | Receipt block is canonical, not finalized | Retain job/receipt; successful guardian/review may continue to execution within TTL |
| `confirmed` | Successful receipt block is finalized | Reconcile matching finalized vault state before acknowledgement |
| `reverted` | Revert receipt block is finalized | Keep payout queued; a newly assessed review may use an explicitly numbered retry |

Before allocating a new nonce the sender revalidates prior receipts. A missing
receipt is not sufficient to declare a reorg: a previously included block must be
proven orphaned by its canonical hash before its original signed bytes are replayed.
Orphaned anchors remain in `orphanedReceipts`. Re-inclusion must match the original
transaction hash. Disk failures during inclusion/finality/reopening leave the
original bytes and job recoverable.

When a committed **finalized** block hash changes, the watcher enters a durable
quarantine, clears cached backing and behavioral history, and retains pending jobs,
checkpoint anchors and transaction records for investigation. The runner stops
before recovering ALLOW/execute transactions. Safety checks run again immediately
before signing/broadcast. Restart cannot clear quarantine. This treats inconsistent
RPC/provider finality as an incident too; it does not claim that a consensus failure
has been independently proven.

Quarantine stops this operator's new authorizations/publications. It cannot recall
bytes already broadcast or an on-chain ALLOW; those still depend on the signed TTL
and guardian checks. An affected route needs operator investigation and, when
necessary, an on-chain pause through the existing guardian/owner controls.

ADR-016 introduced **schema v2**, binding `local`/`finalized` mode to its scope.
ADR-017 advances the current database to **v3** for immutable source/settlement/nonce
claims, adapter policy fingerprints and standalone source quarantine. Both v1 and
v2 are refused with their pending work preserved; migration requires reconciliation.
See the [CCTP escrow runbook](tripwire-cctp.md). The legacy demo runner still holds
unverified source data; only the explicit CCTP factory configures the real adapter.
V1 is rejected with its data intact. Before migrating a previously running operator:
stop it, back up its database/sidecars, reconcile all old signed transactions and
on-chain allowances, and define a canonical rescan point for the selected bridge.
Do not delete/rename the old database or choose a fresh state filename to bypass
its version/quarantine error; that hides queued work and nonce ownership. Automated
migration/resume after a finalized-history incident is intentionally not supplied.
No live state was migrated in this change.

## Continuous protection refresh (ADR-019)

The guardian already accepts same-tier attestations to extend protection by
24 hours; previously the operator skipped every same-tier assessment. The
durable operator now reads `getRoute` and `oracle` at one latest block, validates
the response and rechecks that block's number/hash/timestamp. The head must not
lag any write receipt already observed in this journal. This is a state/clock
snapshot for short signature TTLs; source evidence and terminal acknowledgements
retain their finalized policy.

Every tick re-evaluates pending requests with the watcher. If fresh risk still
justifies the active tier and at most one hour remains, the attestor signs a
refresh. A higher tier escalates immediately; a lower score never extends a
higher tier. Clear, indeterminate, invalid and unavailable assessments do not
renew old protection. Same-tier DELAY refresh retains the original delay window,
as enforced by the existing guardian. After a confirmed refresh, the new on-chain
expiry suppresses repeated signatures, including after restart. Concurrent
attestor calls are serialized.

`AttestorOptions.refreshBeforeSeconds` defaults to 3600 and accepts 1–3600;
signature TTL defaults to 300 seconds and accepts 1–600. A reconciled snapshot's
chain timestamp controls both expiry decisions and signature TTL, independent
of the host/caller clock. Legacy fixture/demo ports without `protectionState`
can escalate but cannot automatically refresh; a failing configured snapshot
never falls back to those ports.

Guardian snapshot errors, unconfigured routes and a mismatched oracle return
`unavailable`. The release runner retains the job and submits neither its review
nor payout. Canonical source checks still run before signing/publication;
durable quarantine prevents refresh as well as release work. All refresh sends
use the existing signed/included/finalized outbox. An unresolved signed transaction
blocks new nonce allocation; an ordinary unfinalized reorg replays its original
bytes. No new persistence schema or scheduler service was introduced.

Restart reads current chain state rather than reconstructing expiry from a local
last-send timestamp. An offline gap can already have let the tier expire; fresh
risk then establishes a new tier and DELAY opens a new review window. RPC/data
outages, process downtime and old signed bytes cannot guarantee continuous route
protection. Pending/held vault requests retain their independent review gate.
Completed/rejected jobs are not permanent incident flags and do not auto-renew
protection forever. Owner `resume` can be followed by a new escalation if a still
pending request again presents fresh risk: stop/reconcile the operator when
human review intends to suppress that response. No automatic resume or downgrade
was added. Continuous operation still needs fresh route baselines and reliable
data; the default unconfigured CLI does not manufacture them.

Validation: 24 expiry/restart/clock/concurrency/oracle/RPC cases, including actual
guardian bytecode, plus four durable-queue integration regressions. No live
refresh, public transaction or deployment was performed.

## Route policy v2 and request delay (ADR-020)

The RPC runner now requires guardian/release policy markers 2 and a scoped
`isProtected(vault, routeId)` grant before opening a journal or signing. ALLOW
reviews use EIP-712 domain version 2. Historical deployments/signatures cannot be
silently reused. Contracts need a fresh reviewed deployment and reconciliation
of outstanding funds, queued requests and signed work.

A large request under DELAY has its own sticky 30-minute clock, including requests
reviewed after the original route window. The runner reads that clock and request
at one checked block. While a verified request still merits ALLOW but its delay
is pending, it keeps the queue without repeated review signatures. Source/risk
and route protection continue to be evaluated; new HOLD/REJECT are submitted
immediately. At maturity, a fresh review is submitted before simulating/executing.
Expired reviews never become valid merely because a delay has elapsed.

The guardian's cap now counts conservative rolling usage; resume/configuration
cannot reset recent spending. Repeated testnet demos refuse a busy budget before
reset writes. See [the complete policy](tripwire-route-policy.md) for the 224-second
one-hour conservatism bound, gas tradeoff, permissions, compatibility and rollout.
