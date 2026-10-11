# Receipt-backed acceptance of a fresh payment deployment — 2026-10-06

This is the next standalone, keyless step after the
[unsigned preparation and funding check](tripwire-testnet-readiness.md). It validates
a fresh product deployment against the prepared package. It does not deploy, sign,
burn, mint, release or return funds. The selected Base Sepolia → Ethereum Sepolia
route and manifest-v3 profile remain unchanged.

## Why runtime equality needs receipt provenance

Compiled runtime equality establishes the current instructions and constructor
immutables. It does not alone prove the initcode that installed them or initial
mutable storage. Different creation code could install the same runtime while
inventing recipient mapping entries or other storage. Positive getters also do
not enumerate all guardian permissions. The acceptance step therefore checks the
actual creation/configuration transactions as well as code and current initial state.

## Public inputs and command

Use the existing public `version: 3` deployment configuration. Create a receipt
template before sending the ordered package:

```sh
npm run tripwire:cctp:accept -- --template payment-config.json new-receipts.json
```

The template contains a deterministic hash of the current unsigned package and
exactly four nullable transaction hashes:

```json
{
  "version": 1,
  "packageHash": "0x<32-byte hash of the prepared package>",
  "transactions": [null, null, null, null]
}
```

Record actual hashes after each transaction, in package order: guardian creation,
customer escrow creation, route configuration, and escrow permission. Null means
not recorded. Never fill these entries with synthetic example hashes. The package
hash binds the current compiler artifacts, constructor configuration, roles,
predicted addresses, nonce, route and all transaction data. Regenerating a package
after nonce/artifact/configuration changes also requires a fresh receipt template;
mixing hashes from incompatible packages is refused.

Then run:

```sh
npm run tripwire:cctp:accept -- payment-config.json receipts.json new-acceptance.json
```

The CLI uses only an abortable public Sepolia client (`SEPOLIA_RPC_URL` or the chain
default), bounded retry/timeouts and schema-validated public data. Public transaction
hashes, addresses and read queries go to that RPC provider. No wallet client or
private-key environment loader is imported. Existing output files are never
overwritten; new public JSON files have restrictive permissions. Errors do not
print credential-bearing provider URLs.

Exit 0 means this initial deployment snapshot passed; exit 2 produces a complete
**pending** report for missing/not-yet-finalized evidence; exit 1 refuses acceptance
for incompatible inputs, contradicted evidence, malformed/unavailable RPC data,
changed configuration/runtime or output failure. Pending reports always have
`initialDeploymentAccepted: false`; they do not read code or mutable deployment
state to substitute for missing provenance. An accepted report has no signatures
and always has `enforcement: false`.

## What must match

| Evidence | Acceptance condition |
| :--- | :--- |
| Network/package | Exact Ethereum Sepolia identity and current prepared package hash; no legacy product input or duplicate transaction claims |
| Transactions | Exact hashes, chain ID, senders, targets, zero ETH value, complete initcode/calldata and both predicted creation nonces |
| Receipts | Successful status, expected created contract/null for configuration, matching sender/target/block/hash/transaction index |
| Order/finality | Package order, including transaction indices within one block; all four successful receipts canonical and finalized before the common state snapshot |
| Runtime | Full reconstructed guardian/payment runtime equality, including every immutable word and EIP-712 cache |
| Roles/bindings | Configured owner/oracle and customer/source/recovery identities; token, guardian, route, Circle domains/contracts, format 3 and common protection policy 2 |
| Guardian state | Exact cap/window, zero observed rolling usage, no initial tier/pause/delay/expiry and the configured route grant |
| Customer policy | Version 1, exact canonical Solidity ABI constructor policy hash and values, all initial recipients permitted, unpaused, no queued change |
| Accounting/compatibility | Zero credited/paid/returned totals, 600-second review TTL and one-day policy-change delay |
| Grant history | Exactly one `ProtectedSet` from guardian creation through snapshot; caller/route/allowed and full provenance match the recorded grant transaction |

The canonical initial policy hash uses the existing Solidity constructor's ABI
tuple, including recipient **order**, chain, escrow, route, token, guardian and the
entire customer configuration. A local EVM deployment independently verifies that
the TypeScript hash agrees with the actual contract. This is separate from the
JSON package fingerprint.

Grant history is queried in bounded 2,000-block pages over at most 50,000 blocks,
with schema and range/address checks. Missing, removed, duplicate, additional,
foreign or incorrectly anchored logs refuse this fresh-package acceptance. A
larger history requires explicit reconciliation instead of an unbounded scan.
The mapping has no enumeration getter; honest complete RPC logs remain trusted.

After reading state/history, receipt anchors are rechecked. The shared finalized
state block's number/hash/timestamp must remain unchanged, and the provider's
finalized head must not move behind it. The report records all transaction anchors,
input hashes, gas used, exact runtime hashes, initial policy and route budget,
grant evidence, destination ingestion start block and manifest.

## Limits and next use

Acceptance covers one **finalized initial snapshot**. It is intentionally refused
after legitimate policy changes, credits, guardian protection or other grants;
this command is not a health check for an already operating payment service.
Use the existing [observer/operator](tripwire-payment-operator.md) for ongoing
checks, and reconcile the initial report rather than modifying the package to
make later state look fresh. Current live roles, grants, policy and guardian state
must still be rechecked immediately before the first burn.

This CLI is an explicit deployment acceptance step in the pilot runbook. It does
not add an automatic deployment/burn sender or replace the operator's existing
runtime/current-policy checks. No source-account control or bypass-permission
review, real Circle transfer, behavioral baseline, external security audit or
production partner approval is established by this report. RPC responses are
provider-trusting evidence, not an Ethereum consensus light client.

## Actual execution of this milestone

The keyless funding recheck at **2026-10-06 06:12:05 UTC** still showed four
blockers: zero Sepolia ETH for owner/operator, zero Base Sepolia ETH for source
sender and zero source USDC. The new local receipt template has four null entries.
An actual keyless acceptance run at **2026-10-06 06:20:32 UTC** returned **pending**,
with four missing-transaction blockers and no deployment acceptance. Its package
hash matches the current unsigned preparation. No public transaction, wallet
key read, faucet request or real Circle receipt was produced.

Validation: **889 tests in 57 files pass**, including 56 new synthetic acceptance
vectors. They cover payload/role/nonce/address substitution, reverted/conflicting
receipts, canonical/finalized snapshots, ordered same-block transactions, runtime
and mutable policy/accounting changes, complete grant provenance and final anchor
rechecks. Build/typechecks and lint pass. Synthetic vectors establish local behavior;
they do not substitute for recorded live deployment or payment evidence.
