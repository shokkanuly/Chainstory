# Payment pilot acceptance and keyless preflight — 2026-10-06

This milestone prepares the existing customer-payment-v1 operator for a fresh
Base Sepolia → Ethereum Sepolia pilot. It does not deploy a contract, obtain faucet
tokens, sign a transaction or record a public payment. The browser remains read-only.

## Exact Tripwire runtime acceptance

The compiler now emits operator-only runtime templates and named immutable offsets
for `TripwireGuardian` and `CctpPaymentEscrow`. A fresh compile is compared against
these templates in the artifact tests. Reconstruction substitutes every immutable
word, including EIP-712 cached chain/address/domain and short strings, the token,
guardian, route, Circle bindings, customer authority/source/recovery and delay.
Unknown references, missing bindings, nonempty template words, out-of-bounds or
overlapping offsets are rejected. Immutable byte ranges are never ignored or masked.

Manifest-v3 operator startup compares full deployed code at a hash-checked finalized
block before creating or recovering the write journal. The keyless observer checks
the same code at startup and every poll. Empty or substituted code cannot pass
solely by returning expected version/getter values. Historical manifest v1/v2
acceptance is unchanged; this guarantee applies only to the explicit product profile.

Code equality does not attest mutable storage, code review or consensus. Existing
finalized binding/grant/role checks remain required. Customer policy and recipient
storage must be inspected against the approved deployment package before any burn;
the operator also checks current policy gates for each release. Guardian budget
configuration must be checked independently. RPC honesty, Circle contracts/proxies
and attestation remain trusted. No external security review is claimed.

## Prepare and check without a key

Use a public `version: 3` deployment configuration, described in the
[payment operator runbook](tripwire-payment-operator.md#deployment-package).

```sh
npm run tripwire:cctp:plan -- payment-config.json new-payment-plan.json
npm run tripwire:cctp:preflight -- payment-config.json new-readiness.json
```

The preflight CLI does not import a wallet/environment key loader. It uses only
public RPC URLs (`BASE_SEPOLIA_RPC_URL` and `SEPOLIA_RPC_URL`, or chain defaults),
abortable transports, bounded retries/timeouts and validated responses. Addresses
and read requests are sent to those RPC providers. Ctrl-C cancels requests. New
report files are exclusive creates with restrictive permissions; existing reports
are never overwritten. Credential-bearing RPC errors are not printed.

Exit 0 means funding/nonce checks passed; exit 2 means a complete report contains
blockers; exit 1 means configuration, RPC or output failure. A report is not signing
authorization or deployment acceptance, even when its limited checks pass.

It records:

- Both exact chain identities and hash-checked latest snapshots, with timestamps.
- Code presence/hashes for pinned Circle token/messenger/transmitter addresses and
  six USDC decimals. These are external code observations, not reviewed Circle
  implementation hashes; proxies can change implementation independently.
- Pending deployer nonce and whether predicted guardian/escrow addresses are empty.
- Exact bigint ETH balances aggregated per chain/account, and source USDC balance.
- Current guardian creation gas estimate, gas price and their product. This quote
  covers step 1 only; it is transient and is not a transaction fee ceiling.
- Package, creation artifact and expected fully patched Tripwire runtime hashes.
- Explicit funding, estimate, occupied-address and nonce blockers and remaining gates.

Missing/malformed protocol data or changed snapshot blocks refuse a report. A failed
gas estimate produces an explicit blocker and no invented cost. Nonzero balances
do not prove sufficient gas for later operations. Dependent escrow/configuration
transactions must be simulated and priced after guardian deployment. A new pending
nonce invalidates the full predicted-address package; regenerate it rather than
editing only the nonce. Recheck balances, nonce and fees immediately before signing.

## Actual public snapshot

Captured **2026-10-06 06:07:27 UTC**, with no transaction submission. Generated
public configuration/package/manifest/report are stored locally under ignored
`.tripwire/pilot/`, independently of the older legacy deployment plan. No private
key was read for this preparation. The chosen 10 USDC maximum, 5 USDC approval/delay
thresholds, 30-minute delay, one-hour recovery and 100 USDC/hour guardian cap are
test assumptions, not agreed production customer limits.

| Account / role | Network | Observed balance | Next requirement |
| :--- | :--- | :--- | :--- |
| Deployer | Ethereum Sepolia | 0.036979933383199686 ETH | Requote each dependent deployment step |
| Owner / customer authority / recovery requester | Ethereum Sepolia | 0 ETH | Test ETH for configuration, approval and requesting return |
| Oracle / operator | Ethereum Sepolia | 0 ETH | Test ETH for reviews, execution and relayed mature return |
| Authorized source sender (same public owner address) | Base Sepolia | 0 ETH and 0 USDC | Test ETH and test USDC before a burn |

The checked pending deployer nonce was 71. Both predicted contract addresses had
empty code. First guardian estimate: 1,789,549 gas at 1,111,524,922 wei/gas, yielding
**0.001989128312640178 ETH** at that snapshot. This is not the escrow/full pilot cost.
The preflight produced four blockers (three empty gas accounts and empty source USDC).
Addresses are in the local public configuration/readiness report; no mainnet funding
is required for this test. [Circle Faucet](https://faucet.circle.com/) offers test USDC
for Base Sepolia; its human verification must be completed by the wallet operator.
No faucet request was made in this milestone.

## Remaining live sequence

1. Fund the listed accounts on their exact test networks. Check recipient addresses
   and preserve local key files; never paste keys into chat or the browser app.
2. Rerun keyless preflight into a new report. Reprepare the entire package if the
   deployer nonce changed. Inspect chosen test recipients, limits and recovery roles.
3. Execute ordered unsigned deployment/configuration transactions with local
   controlled accounts, each freshly simulated and fee-quoted. Record successful
   receipts and run [receipt-backed initial acceptance](tripwire-deployment-acceptance.md)
   for both creation/configuration provenance, exact runtimes, finalized roles,
   complete grant history and initial customer policy/storage. Start the keyless
   observer with manifest v3. Acceptance is a snapshot; recheck live gates before a burn.
4. Prepare a small Standard burn using the real live policy hash, unique operation,
   fixed recovery recipient, five-word hook, exclusive escrow caller and current
   Standard fee. Burn only after deployment acceptance. Record the actual source
   receipt and Circle-attested destination mint, then add the exact proof locator.
5. Observe first. Missing live baseline/pricing/screening still means HOLD. Do not
   copy the synthetic test baseline into a public ALLOW configuration.
6. With validated behavioral inputs, exercise ordinary payout, manual approval,
   delay, policy invalidation, fixed-destination return, outages and process restart;
   record exact public receipts and reconciled outcomes. External review and partner
   acceptance remain required before any real-money pilot.

## Validation

833 tests in 56 files pass, including 21 added checks of compiler runtime metadata,
actual local EVM constructor patches, changed immutable values/code, pre-journal
refusal, observer repolls and keyless funding/nonce/snapshot failures. Build,
operator typechecks, lint and the synthetic local payment workflow pass. Public
evidence in this milestone consists only of RPC read snapshots and a gas estimate;
no real Circle burn/mint/payout/return receipt was captured.
