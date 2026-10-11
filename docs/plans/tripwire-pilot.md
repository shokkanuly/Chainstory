# Tripwire USDC pilot — 2026-10-05

First route: CCTP v2 Standard USDC, Base Sepolia → Ethereum Sepolia.
The user selected a testnet pilot and separate local owner/oracle wallets.
The keyless observer and unsigned deployment planner are implemented locally.
No deployment, wallet funding, burn, mint or public payout has been sent.

## Prepare a fresh deployment

`tripwire:deploy` remains the synthetic DemoUSDC bridge deployment. It does not
deploy this pilot. Use the reviewed guardian and `CctpEscrow` artifacts instead.

The planner takes only public role addresses, the deployer's pending nonce and
exact integer limits. Owner and oracle must differ; deployer and oracle must differ.
An initial test assumption is 100 testnet USDC per hour (100000000 base units).

```json
{
  "deployer": "0x<PublicDeployerAddress>",
  "owner": "0x<PublicGuardianOwnerAddress>",
  "oracle": "0x<PublicOracleAddress>",
  "deployerNonce": "<PendingNonce>",
  "capBaseUnits": "100000000",
  "windowSeconds": "3600"
}
```

Replace placeholders, then:

```sh
npm run tripwire:cctp:plan -- config.json new-plan.json
```

The package contains predicted guardian/escrow addresses, initcode, artifact hashes,
two deployments and two owner calls (`configureRoute`, scoped `setProtected`),
plus a version-2 empty observer manifest. It produces no signatures, sends nothing
and refuses to overwrite an existing plan. Any deployer nonce change invalidates
the predicted addresses; regenerate and review immediately before execution.
Check live bytecode/configuration, confirmed receipts and the observer's finalized
binding checks before sending test USDC. Getters alone do not attest bytecode.

Locally created wallet files and the concrete public deployment package live in
ignored `.tripwire/pilot/`. Private files use mode 0600. They must remain local;
the public package contains no private key. Owner/oracle are initially unfunded.
Deployment/configuration need testnet ETH; observation needs no key or gas.

## Observe real testnet transfers

Extract `manifest` from the accepted deployment package to `manifest.json`.
Start with `requests: []`, then add public source/destination transaction locators
as described in [the CCTP runbook](tripwire-cctp.md#read-only-audit-command).
This version observes explicitly listed requests, at most 100; it does not
discover or relay burns/mints. Use the actual request ID emitted by the escrow.

```sh
npm run tripwire:cctp:observe -- manifest.json .tripwire/pilot.sqlite
npm run tripwire:cctp:observe -- manifest.json .tripwire/pilot.sqlite --watch --interval=10
```

Watch reloads and validates the manifest each poll. Proof locators may be added;
deployment, policy, guardian and operator identities cannot change in that process.
Only version-2 authenticated escrow with guardian/release policy 2 and a scoped
route grant is accepted. RPC overrides are `BASE_SEPOLIA_RPC_URL` and
`SEPOLIA_RPC_URL`; they are not printed. SIGINT/SIGTERM cancel RPC work and release
the journal lease. A transient failed observation emits `unavailable` and retries
in watch mode; durable finality quarantine stops the process.

Each JSON line records the finalized state block, observation time/duration,
guardian owner/oracle/role checks, actual tier/expiry/cap, exact release amount,
state and delay, source-evidence status and counts. Malformed or unreadable
individual requests report unavailable while other requests can still be checked.
Backing mismatches propose REJECT; missing evidence proposes HOLD; terminal
requests propose NONE. **Verified backing still proposes HOLD:** live baseline,
pricing and recipient screening are not configured by this observer. These are
recommendations only; the observer never signs a review, freezes a route or pays.
`status: ok` means the observation succeeded, not that enforcement is ready.

Amounts serialize as decimal base-unit strings. Counts are one snapshot of listed
requests, not cumulative traffic, accuracy, prevented losses or false-positive rates.
Guardian state is finalized and can lag the latest chain head; use transaction
timestamps to measure source finality and added operator delay separately.

The observer shares the existing verifier's deployment-bound SQLite claims and
quarantine policy. Use the same stable journal for later enforcement, with the same
manifest operator. Stop observation before starting an audit or signing operator;
one process may own the journal. Observation never recovers or publishes existing
signed transactions. The original `tripwire:cctp:verify` output remains compatible,
including explicit legacy version-1 read-only audits.

## Exit conditions for this pilot

1. Fresh testnet deployment with separate owner/oracle and verified live bindings.
2. Recorded real burn → authenticated escrow mint → independently verified request.
3. Replay, wrong amount/recipient, unavailable RPC and restart cases measured with
   preserved public evidence and journal state. No testnet result is a mainnet claim.
4. Versioned real baseline/pricing/screening and a signing runner configured through
   `createCctpRpcOperator`; measure honest HOLD frequency and added payout latency.
5. Small protected testnet payouts, confirmed receipts and reviewed recovery rules.

Rejected credits currently remain locked. Recovery/refund policy and external
contract/security review remain required before accepting real-value deposits.
This pilot gates its escrow, not all Circle transfers. Circle attesters/contracts,
RPC finality and guardian administration remain trust dependencies.
