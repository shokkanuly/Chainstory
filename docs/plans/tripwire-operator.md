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
| `scripts/tripwire/testnet/operator.ts` | Sepolia RPC, local signing, gated-vault binding checks and durable guardian/review/execution sends |

Feeds expose `checkpoint()` and `restore(cursor)` in addition to `poll()`.
A durable watcher refuses a feed without those methods. Both cursors, burns,
pending releases, completed message IDs, conflicts and release history are stored
in one atomic snapshot; a failed ingestion rolls both feeds back to the prior range.
Block polls cover at most 2,000 blocks. RPC/decode failure leaves the range retryable.
Amounts are bigint in memory and canonical decimal strings on disk. Behavioral USD
heuristics still use the existing approximate demo pricing; a real price/baseline
adapter is not part of this change.

Acknowledgement is asynchronous and serialized with polling. Callers must await it.
A HOLD review, a failed transaction or a guardian-delayed payout is not completion.
The durable runner only removes a request after matching on-chain EXECUTED or
REJECTED state. On restart it settles outstanding signed transactions first,
then reconciles terminal vault states before creating any new transaction.

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
while an earlier transaction is outstanding. Already-known/nonce-too-low responses
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

This stores confirmations, not canonical-chain proofs. Finality, block-hash/reorg
reconciliation, a real bridge/source adapter, live baselines, guardian protection
refresh, gas replacement and queue compaction remain in the hardening plan. SQLite
snapshots are intended for a single-route pilot, not high-volume production.
