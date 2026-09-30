# Tripwire CCTP v2 USDC adapter

Implemented locally on 2026-09-30. The first supported route is **Base Sepolia
(chain 84532, CCTP domain 6) → Ethereum Sepolia (chain 11155111, domain 0)**,
Circle USDC, Standard Transfer only. No public burn, mint, deployment or payout
was performed. Fixtures are synthetic protocol vectors, not recorded live traffic.

## Escrow flow and trust boundary

USDC must mint into a fresh release-gated `ProtectedVault` on Ethereum Sepolia.
The vault's immutable token must be Circle's Sepolia USDC; the existing DemoUSDC
vault cannot be used. The route string is
`cctp-v2:base-sepolia:ethereum-sepolia:USDC`, with its keccak256 as `routeId`.

1. A sender uses Circle's `depositForBurnWithHook`, with the configured source
   USDC, destination domain 0, mint recipient = the padded vault address,
   minimum finality 2000 and an explicit maximum fee below the burn amount.
2. The hook is exactly `cctpBeneficiaryHook(endRecipient)`: the keccak256 of
   `Tripwire/CCTP/v2/USDC/beneficiary/v1` followed by a zero-padded EVM address.
   This is a **Tripwire metadata convention**, not Circle's executable hook
   standard. TokenMessenger does not call the beneficiary or create a release.
3. Circle attests and the standard CCTP receive flow mints USDC into the vault.
   Tripwire waits for finalized destination settlement. It does not submit the
   burn, fetch attestations, relay `receiveMessage`, or automatically create owner
   requests. Direct transfers that mint to the end recipient are unsupported.
4. The vault owner requests the exact net payout to the hook beneficiary under
   `cctpReleaseId(sourceChainId, sourceTransmitter, sourceTxHash, sourceLogIndex)`.
   The ID uses ABI encoding and a separate Tripwire domain separator. V2 assigns
   its nonce offchain after emission, so the emitted zero nonce is not an ID.
5. The operator authenticates source and destination receipts, journals their
   claims, then applies the existing risk/review/guardian gate. Missing baseline
   still means HOLD. A verified source proof alone is not an ALLOW decision.

This is an **operator-side post-mint escrow adapter**, not a global pause switch
for Circle's permissionless protocol. Its authentication relies on Circle's
contracts/attesters and trustworthy RPCs. The vault still trusts its review oracle;
a compromised oracle can approve an unrelated owner-created request. A production
bridge integration needs an on-chain authenticated request/escrow boundary and an
external review. This change does not claim that boundary is implemented.

## What is authenticated

Both RPC chain identities, canonical receipt/log hashes, transaction identities,
removed/duplicate logs, successful transactions and RPC `finalized` tags are
checked. Base finality follows its L1-derived finalized head; Circle's received
event must additionally report standard finality 2000. There is no block-count,
latest or safe fallback, and no independent L1 derivation/consensus light client.

The configured source MessageTransmitter's `MessageSent` must identify the exact
source/destination domains, registered TokenMessengers, source USDC and escrow
vault. A matching `DepositForBurn` binds the depositor, amount, hook, caller and
maximum fee. The first adapter supports one source transfer per transaction.

One destination transaction must contain one `MessageReceived` from the configured
transmitter and one preceding `MintAndWithdraw` from the configured messenger.
The received burn body must preserve all immutable source fields. The nonce must
be nonzero; an explicitly restricted destination caller must match. The actual
fee must be at most the source maximum and below the burn amount. Any expiration
must have been valid **at mint time**, not at the later escrow payout time.
The minted token, vault, fee and exact net amount must match the requested payout.
Neither overpayment nor underpayment has the demo's 1% tolerance.

Unknown versions/hooks, malformed or unavailable data, Fast Transfers and ambiguous
batches stay held. Authenticated binding mismatches are invalid. Reverted or
unfinalized/missing destination settlement is pending; a burn does not fund escrow.

## Durable claims and signing guards

SQLite schema **v3** binds the adapter policy fingerprint to the deployment. Before
VERIFIED, one atomic insert uniquely claims the source event position, destination
settlement position and Circle nonce. Exact recipient/net amount, block anchors
and payload hashes persist across restart. Rechecking the same release is
idempotent; another release cannot claim those credits. A disk write failure
returns unavailable, never VERIFIED.

Every tick, signature and raw-transaction publication also checks previously
accepted proof anchors, including completed jobs. A changed committed finalized
proof durably quarantines the source, even if discovered by the audit command
before any watcher snapshot exists. Restart cannot clear it. Lagging RPCs are
unavailable; they do not erase journaled claims. Schema v1/v2 or another adapter
scope is refused with the old queue preserved. Stop/reconcile/back up outstanding
signed work before an explicit migration; never delete the journal to retry.

## Read-only audit command

Create a manifest with real public addresses and transaction hashes:

```json
{
  "version": 1,
  "vault": "0x<VaultAddress>",
  "guardian": "0x<GuardianAddress>",
  "operator": "0x<OperatorPublicAddress>",
  "requests": [{
    "messageId": "0x<DerivedReleaseId>",
    "proof": {
      "sourceTransactionHash": "0x<SourceBurnTransactionHash>",
      "sourceLogIndex": 3,
      "destinationTransactionHash": "0x<DestinationMintTransactionHash>"
    }
  }]
}
```

Replace angle-bracket placeholders. The index is the receipt's actual log index,
not its array position. Omit the destination hash until available; this yields
pending. A transaction locator is a lookup hint, never evidence by itself.

```sh
npm run tripwire:cctp:verify -- manifest.json .tripwire/cctp-Vault.sqlite
```

Optional RPC overrides: `BASE_SEPOLIA_RPC_URL`, `SEPOLIA_RPC_URL`. The command needs
no private key and sends no transactions. It reads actual finalized vault bindings
and release fields instead of trusting manifest-supplied amounts or recipients.
Results use decimal strings for base units. It writes claims/quarantine into the
same operator state file and refuses its process lease while the operator is running.
The manifest's operator address must match the sender intended for that state.
Errors omit RPC URLs/credentials. RPC calls use existing viem timeouts/retries and
are abortable on SIGINT/SIGTERM.

## Operator integration

`scripts/tripwire/testnet/cctpOperator.ts` exports `createCctpRpcOperator` and accepts:

- Existing signing config and Ethereum Sepolia clients, a `RpcDestination`
  (`chainId`, route/string ID, vault, guardian, token and destination start block).
- A Base Sepolia **public** client and source start block. When creating it, use
  `chain: baseSepolia as Chain` to keep its public-client TypeScript shape compatible
  with the generic existing EVM feed; no source wallet is required.
- The deployment-bound SQLite filename and `locate(messageId)` returning a
  validated manifest locator or null. Reload/validate updated manifest data in this
  callback to retry a delayed mint; accepted claims remain immutable.
- An actual route baseline (or null to HOLD) and optional recipient contract facts.

It returns the existing `{ tick, watcher, sender, store, close }` operator lifecycle.
Source discovery is finalized and route-filtered; unsupported/irrelevant messages
are skipped while retaining the canonical checkpoint. Verification independently
reads full receipts, so discovered burn hints cannot authorize a payout.
The existing `tripwire:operator:sepolia` command remains the synthetic deployment
runner and does not enable this adapter automatically.

## Validation and remaining pilot work

45 adapter tests cover protocol vectors, exact large amounts/fees, wrong identities
and payout fields, unsupported modes, missing/finalized evidence, malformed logs,
ambiguous pairing, failed persistence, restart/replay claims and source quarantine.
The suite also covers watcher HOLD→ALLOW after finalized mint and publication guards.
The finalized feed tests cover provenance-aware filtering without cursor loss.

Next: a fresh USDC escrow deployment with separate owner/oracle, authenticated
request creation, a recorded real testnet transfer, route baseline/evidence versions
and an observe-only pilot. Fast Transfer, other assets/routes, batched pairing,
Iris discovery/relaying and automated owner requests are outside this first adapter.

Protocol facts are pinned to
[Circle EVM contracts a92a2b4](https://github.com/circlefin/evm-cctp-contracts/tree/a92a2b4e7e6ef99bf0b05dca71780f5ec190e729),
[Circle addresses](https://developers.circle.com/cctp/references/contract-addresses),
[USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses),
[message layout](https://developers.circle.com/cctp/references/technical-guide),
[Circle finality policy](https://developers.circle.com/cctp/concepts/finality-and-block-confirmations)
and [Base derivation](https://docs.base.org/base-chain/specs/protocol/consensus/derivation).
