# Customer payment operator integration — 2026-10-06

Implemented locally on the existing standalone operator, SQLite outbox and CCTP
receipt verifier. This is a runnable testnet integration, not a deployed or audited
service. All new evidence fixtures are synthetic. No public burn/mint/payout/return
was submitted and no real Circle receipt was recorded in this milestone.

H4c1 records [the proposed customer advisory/screening policy](tripwire-behavioral-policy.md), ADR-038:
independent issuer evidence, explicit customer consent and coordinated new-version
migration. This is a design only; execution still uses legacy enforcement.
The next H4c2 step implements pure read-only evidence verification, not ALLOW.

## What now works

| Path | Required evidence / behavior |
| :--- | :--- |
| Funding | Both finalized receipts, exact net USDC, exclusive escrow caller, customer source account, payment hook and atomic mint/credit events |
| Operation | Exact operation ID, return beneficiary and source-intent policy hash; operation/source event/settlement/nonce claimed once |
| Review | Policy version/hash, approval, pause, recipient, amount, return and both delay clocks read at one hash-checked latest block |
| Payout | Fresh format-3 signature plus existing risk, guardian and contract execution gates; customer approval cannot bypass other constraints |
| Rejected credit | Retained in the queue; rejection alone does not dispose of funded customer money |
| Return | Customer must first request it on-chain; operator only relays `executeReturn` after maturity to the immutable destination |
| Completion | Matching hash-checked finalized state; distinguish `RETURNED` from payout `REJECTED`; persist immutable exact-amount outcomes |
| Restart | Source/destination canonical checks precede recovery; original signed bytes/hash retained; new attempt only after finalized revert |

Snapshot reads must not lag an authenticated settlement or a write receipt already
observed by this journal. A finalized terminal read behind a recent inclusion means
retry, rather than completion or an unhealthy-state reset. Malformed/mismatching
customer credits and mixed policy blocks cannot produce ALLOW.

No heuristic shadow mode has been enabled. Existing behavioral checks still gate
payouts and can raise guardian protection. Missing baseline/price/screening means
HOLD. A mature, independently verified customer return does not require a clean
behavioral score and does not depend on the guardian allowing business payouts.
The operator cannot request returns, approve payments, change recipients, change
customer policy, burn USDC, mint USDC or automatically bridge returned funds back.

ADR-036/H4a documents the [decision matrix](tripwire-decision-matrix.md) and adds
a separate read-only behavioral projection. That model is not an operator mode
or input accepted by review/attestor/source verification. Current baseline/price/
screening HOLD and customer/guardian gates still apply. Behavioral enforcement
separation requires the later reviewed H4c policy/compatibility step.
ADR-037/H4b adds an optional public advisory extension and read-only viewer;
keyless customer observations explicitly report assessment-not-produced. This
adds no scorer input/provider or signing-operator mode, and does not remove HOLD.

## Manifest v3

The existing verifier and observer accept version 3 with a required `payment`
object. Versions 1/2 keep their historical meanings. Example shape (replace public
address placeholders; this is not deployable configuration):

```json
{
  "version": 3,
  "vault": "0x<EscrowAddress>",
  "guardian": "0x<GuardianAddress>",
  "operator": "0x<OraclePublicAddress>",
  "payment": {
    "authority": "0x<CustomerPolicyAuthority>",
    "sourceSender": "0x<AuthorizedBaseSourceAccount>",
    "returnRecipient": "0x<CustomerEthereumRecoveryAccount>",
    "recoveryDelay": "3600"
  },
  "requests": []
}
```

Each request retains the existing `{messageId, proof}` locator shape: source
transaction hash/log index and destination mint transaction hash. Locators are
hints; the adapter authenticates full receipts independently. Unknown locators
keep jobs held. The observer permits an empty manifest; one-shot verification
requires at least one request. The observer now supports [bounded one-shot
operation discovery](tripwire-operations.md#automatic-operation-discovery-adr-028)
with an empty v3 manifest; it obtains mint/source locators and then authenticates
full receipts. The keyless observer also supports [durable hint lookup and
bounded catch-up](tripwire-operations.md#persistent-discovery-and-restart-recovery-adr-029)
with `--discover-resume`. The signing operator still requires explicit locators;
watch-mode discovery now uses the [keyless sequential worker](tripwire-operations.md#continuous-keyless-observer-adr-030).

The product source profile includes the customer immutable bindings, vault, route,
hook and review semantics in its fingerprint. Product proofs additionally persist
the entire authenticated intent. Existing SQLite schema v3 is retained; a disjoint
`customer-payment-v1` profile prevents legacy proofs/outbox from being reused.
Missing product intent or an unexpected legacy intent is rejected on startup.
Changing bindings/profile requires explicit reconciliation; no automatic migration
or deletion of legacy state is supplied. `release_outcomes` adds exact immutable
executed/rejected/returned records; its recipient identifies the original business
beneficiary. A returned credit's actual destination remains in its authenticated
payment proof and on-chain credit. Outcome and queue acknowledgements are retryable:
outcome is recorded first after finality, then the queue snapshot is committed.

## Deployment package

`npm run tripwire:cctp:plan -- config.json new-plan.json` now also accepts an input
with `version: 3`. Keep the existing deployer/owner/oracle/nonce/route-budget fields;
add the manifest's `payment` fields plus:

```json
{
  "policy": {
    "maxPayment": "10000000",
    "manualApprovalAbove": "5000000",
    "delayAbove": "5000000",
    "delaySeconds": "1800"
  },
  "recipients": ["0x<PermittedCustomerBeneficiary>"]
}
```

These numbers illustrate 10 USDC maximum / 5 USDC approval and delay thresholds
at six decimals; they are not selected customer production limits. The unsigned
package encodes the actual `CctpPaymentEscrow` constructor, records current artifact
hashes and emits manifest v3. Package format version 2 distinguishes this output
from the historical package; manifest version describes escrow/review semantics.
No keys/signatures or transaction submissions are part of the planner.

Deployment nonce and predicted addresses must be checked immediately before an
authorized deployment. Use separately controlled reviewer and customer/guardian
owner roles. Startup verifies immutable getter bindings, guardian/release policy 2,
review format 3, payment escrow 1, 600-second maximum review TTL, route grant and
oracle/customer/owner separation before opening or replaying a write journal.
All product acceptance facts are also checked at a stable finalized block.

The [next acceptance milestone](tripwire-testnet-readiness.md) adds exact runtime
comparison, including every compiled immutable word, to product startup and observer
polls. It also supplies a keyless predeployment funding/nonce report. Before a public
pilot, inspect mutable configuration against the reviewed package, verify customer
recovery/source control and inspect every permitted source outgoing path. Code
equality is not a security audit or independent RPC/consensus verification.
The [initial deployment acceptance step](tripwire-deployment-acceptance.md) now
checks actual creation/configuration receipt provenance, full initial policy and
sole grant history against the unsigned package. It is a separate keyless runbook
step; ongoing operator checks do not require a service to remain in unused initial state.

## Start and observe

Use Node 22.13+ and an explicit ignored testnet key file via `TRIPWIRE_ENV_FILE`.
The account must match manifest operator and guardian oracle. Never paste keys into
the manifest, command arguments or chat. Set `SEPOLIA_RPC_URL` and
`BASE_SEPOLIA_RPC_URL` as needed. Select actual deployment/source scan blocks.

```bash
npm run tripwire:cctp:observe -- manifest.json observer.sqlite --watch
npm run tripwire:cctp:operator -- manifest.json operator.sqlite SOURCE_START_BLOCK DESTINATION_START_BLOCK --watch
```

Use one writer per journal and exclusive control of its account's transaction
nonce. Keep observer and running operator databases separate to avoid lease
conflicts. Existing manifest requests can be reloaded; changes to deployment or
customer bindings stop the operator. The browser remains read-only.

The default operator supplies no baseline, so payouts remain held. An explicitly
validated baseline file can be passed with `--baseline=file.json`; route/statistics
schema and the scorer's freshness/health checks apply. This input is still the
existing approximate behavioral USD pipeline. Validate live pricing, screening,
baseline ownership and false positives before enabling actual payout enforcement.
Supplying a file alone does not establish accuracy or production readiness.

RPC, disk or malformed-state errors stop this CLI with its journal intact. Restart
against the same file; never delete it to clear a pending transaction or quarantine.
Preserve database/sidecars, proof locators and recorded receipts for investigation.
Finalized-history conflicts retain the existing durable quarantine policy.
ADR-034 makes the shared source adapter propagate terminal journal failures from
proof/quarantine reads and writes. They no longer become per-payment unavailable;
the signing CLI stops with its existing journal intact. Already committed claims
remain idempotent. The new detailed process exit codes belong to the keyless
observer CLI; they do not change this signing CLI's failure-code contract.

## Validation and next acceptance gate

Full suite: 812 tests / 54 files; 68 new cases in this slice. New fixtures cover
receipt/hook/operation binding, profile isolation, coherent policy reads, customer
holds, fresh versioned signatures, funded rejection, delayed returns, finality
lag and crashes before/after publication. The RPC integration verifies actual
cryptographic typed-data and transaction signatures against synthetic state and
receipts. It is not a Circle threshold-signature or public-network test.

Build/typechecks, lint and local payment EVM workflow pass. No Solidity change was
needed in this milestone. Prior contract mutation coverage is documented in the
[payment contract runbook](tripwire-payment-policy.md); it was not rerun here.

Remaining: verify fresh public artifacts/configuration; record real finalized
burn→mint→credit receipts; run ordinary payout, HOLD/retry and customer return
drills with actual testnet USDC; separate behavioral shadow policy from mandatory
authorization; add customer read-only operation UI; obtain independent review and
a design partner. No mainnet or prevented-loss claim is supported by these tests.
