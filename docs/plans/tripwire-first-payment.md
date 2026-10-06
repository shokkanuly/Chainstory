# First testnet payment: unsigned preparation

Implemented 2026-10-06, ADR-025. This is a single-step keyless planner for the
first **gross 1 test USDC or less**, CCTP v2 Standard Base Sepolia → Ethereum
Sepolia customer payment. It uses the same product deployment configuration,
receipt acceptance and operator profile. It does not deploy, sign, publish,
retrieve a wallet key, mint or authorize a payout.

## Run it

Complete [funding/preflight](tripwire-testnet-readiness.md) and the actual four
deployment/configuration transactions, recording their real hashes in the
[receipt bundle](tripwire-deployment-acceptance.md). Keep that original public
configuration. Old contracts and synthetic receipts are incompatible evidence.

Create **one** public intent:

```sh
npm run tripwire:cctp:payment -- --intent \
  .tripwire/pilot/payment-config.json .tripwire/pilot/first-payment-intent.json
```

This checks the Base Sepolia source nonce and allowance at a hash-checked block,
chooses the first configured recipient, generates one operation ID, and reserves
the EOA nonce of the future burn. Default gross amount is `1000000` base units
(1 test USDC); `maxFeeBaseUnits` is `1000` (0.001 USDC). That fee cap is a selected
test limit, **not a live Circle quote**. The first-payment maximum is an intentional
local pilot limit, not Circle's or the customer's production limit.

The strict version-1 intent contains only `grossBurnBaseUnits`, `maxFeeBaseUnits`,
`recipient`, `operationId` and `reservedBurnNonce`. Amounts/nonces are canonical
decimal strings, never JSON numeric token amounts. The recipient must be in the
initial policy; the fixed recovery recipient and policy hash come from authenticated
deployment/live state, not caller-supplied intent overrides. Do not recreate or
edit this intent after any approval or burn submission. There is no global intent
lock: use this narrowly with one active intent and one operator controlling the
source EOA, and preserve every actual signed/submitted transaction externally.

Prepare the next action into a **new** output file:

```sh
npm run tripwire:cctp:payment -- \
  .tripwire/pilot/payment-config.json .tripwire/pilot/payment-receipts.json \
  .tripwire/pilot/first-payment-intent.json .tripwire/pilot/first-payment-step-01.json
```

Exit 0 means an unsigned step was prepared, 2 means explicit blockers, and 1 means
preparation was refused (incompatible input/state, RPC failure, simulation failure
or existing output file). Outputs never overwrite existing files. A missing
deployment receipt keeps `nextTransaction: null`; no source action is simulated.
Public RPC URL environment overrides are supported, without loading wallet files.
Snapshot/report timestamps are observations, not expiry guarantees.

## What is verified

1. Fresh receipt-backed acceptance of the exact initial deployment: finalized
   creation/configuration provenance, whole reconstructed runtime, complete
   initial policy/accounting and sole guardian grant history.
2. Re-read the same full initial state at a hash-checked destination latest block,
   no earlier than acceptance. Refuse changed roles, policy, pauses, budget/grants,
   queued changes or nonzero accounting. Require the operation to be unused.
   This deliberately supports the **first unused** payment only; it is not a
   general subsequent-payment planner.
3. Exact source chain, pinned USDC/messenger/transmitter code presence, six USDC
   decimals, messenger local-transmitter/remote-messenger route bindings and a
   configured EOA with empty code. Smart/delegated accounts need a separate
   integration. External Circle code presence/bindings are not implementation
   attestation, permission enumeration or an audit of Circle proxies.
4. Source USDC, allowance, ETH and current/pending nonce; destination role gas
   balances. Require gross amount inside the chosen pilot, customer and route
   caps. Above the customer manual-approval threshold blocks this ordinary
   first-payment path; it requires an explicit post-mint customer-approval workflow.
   Nonzero ETH does not prove adequate gas for all later actions.
5. Call Circle `getMinFeeAmount(grossAmount)` at the source block. Unavailable or
   malformed fees never become zero. Require the selected maximum ≥ the current
   minimum and < gross. When the cap cannot cover the minimum, block and report
   a null net range. Otherwise display the possible net range from gross minus
   maximum fee to gross minus the quoted minimum; only the actual attested mint
   establishes funded credit. The prepared first payment promises no exact net
   recipient amount and does not increase the user's selected cap automatically.
6. Simulate and estimate gas for **only the next action in existing source state**.
   Recheck both block anchors, all deployment receipt anchors and the pending
   source nonce afterward. Changed evidence refuses a plan.

## One action at a time

| Current allowance to the pinned Circle messenger | Prepared action |
| :--- | :--- |
| Zero | Approve exactly the gross payment amount |
| Exactly the gross amount | `depositForBurnWithHook` |
| Any other nonzero value, including unlimited | Reset allowance to zero |

After a reset/approval is actually successful, record its receipt and rerun with
the **same intent**, producing a new report. No burn calldata is emitted or
simulated until exact allowance exists. Approvals target only the pinned Circle
messenger. The burn binds both mint recipient and destination caller to the
accepted escrow, destination domain 0, pinned source USDC and Standard finality
2000. The five-word hook pins the recipient, fixed destination recovery recipient,
operation ID and complete initial policy hash.

The reserved burn nonce equals the current EOA nonce plus the remaining zero,
one or two approval actions. Pending transactions or a different expected nonce
block preparation. After a burn consumes its nonce, rerunning the original intent
cannot prepare another burn even before the destination mint is visible. A
reverted/unrelated transaction also needs explicit reconciliation. This is a
procedural first-payment safeguard, **not a durable sender or global exactly-once
guarantee**: it cannot stop someone generating another intent or signing outside
this tool. Source bypass/control review remains open.

## Before any signature, and after burn

The result is not a publishing approval. Recheck current state, nonce, simulation
and **complete Base transaction fees**, including L1 data cost, immediately before
signing. `gasEstimate` is gas units, not an ETH cost or balance sufficiency proof.
The tool supplies no fee caps for the EVM transaction, signing mechanism or burn
outbox. Use a reviewed sender process and record exact signed bytes/receipts; do
not blindly replay an unsigned report across restarts or outages.

After the single real burn, preserve its real receipt and Circle attestation,
then run the existing [observer/operator](tripwire-payment-operator.md) to verify
the matching finalized net mint and bound pending payment. Wait for actual
settlement; never send another burn to compensate for a delayed mint. Baseline,
screening, pricing and current policy gates remain required for release; missing
inputs continue to HOLD. Fixed recovery is a customer-requested **destination**
return after the configured delay; it is not an automatic reverse bridge or a
guaranteed refund of gross source USDC/network fees. Record payout/return and
outage/recovery evidence before partner acceptance or rollout.

## Protocol sources and current evidence

Source ABI/fee behavior were rechecked against [Circle contract interfaces](https://developers.circle.com/cctp/references/contract-interfaces)
and [TokenMessengerV2](https://github.com/circlefin/evm-cctp-contracts/blob/a92a2b4e7e6ef99bf0b05dca71780f5ec190e729/src/v2/TokenMessengerV2.sol)
/ [BaseTokenMessenger](https://github.com/circlefin/evm-cctp-contracts/blob/a92a2b4e7e6ef99bf0b05dca71780f5ec190e729/src/v2/BaseTokenMessenger.sol)
on 2026-10-06. [Base network fees](https://docs.base.org/specifications/transactions/network-fees)
documents the separate execution/L1 data costs. Protocol selectors and fixed
route constants remain in `src/chains/evm/registry/cctp.ts`; pure unsigned codecs
are in `src/chains/evm/cctpBurn.ts` and public orchestration is operator-only.

Synthetic fixtures cover approval/reset/burn progression, nonce reuse, fees,
policy/amount/recipient gates, live state changes, simulation failures and reorgs.
They establish local behavior, not successful public transactions or a security
audit. Actual funding and public receipt evidence are recorded separately in the
ignored `.tripwire/pilot/` directory; live deployment/transfer remain pending.
