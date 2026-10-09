# Tripwire: handoff to a teammate

**Current continuation point:** [tripwire-progress.md](tripwire-progress.md).
Follow-ups H2a/H2b1/H2b2/H4a/H4b/H4c1 were recorded on 7 October; the original
6 October snapshot is kept below. Translated from Russian on 2026-10-09 when the
branch was integrated into `main` on guardian policy v4 (ADR-046); facts and
numbers are unchanged unless marked as updated.

State as of **6 October 2026, Almaty**. This is a development continuation point,
not a claim of mainnet readiness. The plan lives in the same commit as the
contracts, operator, operations screen and their tests. The original handoff
branch was `codex/tripwire-route-limits`; since 2026-10-09 continue from `main`.

## What we are building and what we promise the user

The first product: control of USDC payments through our escrow on the CCTP v2
Standard route Base → Ethereum, starting with Base Sepolia → Ethereum Sepolia. A
payment binds the recipient, the business operation, the customer's policy and a
fixed return address. A payout is possible only after the source, the actual mint
and the current policy have been checked. The customer can request a separate
return to a pre-agreed Ethereum address after a set delay.

Control covers payments through this escrow. Direct treasury transfers, another
bridge or mint recipient, and owner actions outside the integration are not yet
covered. A return on Ethereum does not undo the burn on Base and does not bridge
back automatically. The agreed product contract is
[tripwire-product.md](tripwire-product.md).

## Exact starting point

| Area | Done locally | Not yet proven |
| :--- | :--- | :--- |
| Contracts | `CctpPaymentEscrow`, source/operation/policy binding, recipient and amount limits, delays/approval/pause, fixed return, credited/paid/returned accounting | Independent audit, a current public deployment, a real return |
| Operator | Review format 3, current policy, source/mint verification, SQLite outbox, finality/restart/quarantine, separate paid/rejected/returned outcomes | Operation on real transfers, quality of live risk inputs |
| Pilot preparation | Public unsigned deployment plan, keyless preflight, exact runtime check, acceptance from four receipts, unsigned first-payment planner | Signing/sending the four deployment transactions, and burn/mint |
| Observer | Discovery for an empty manifest v3, both cursors and hints saved, bounded catch-up, fresh receipt checks, watch/retry/stop, atomic public files | Supervisor, alerts, long-running operation, and more than 100 hints per chain |
| Screen | `/tripwire/operations`, import, search/filters, HOLD/return/receipt timelines, coverage/gaps, stale/error; reading a selected public folder | A full manual browser smoke with the native directory picker, hosted live data |
| Public reports | Optional archival with `--keep-reports`, old files kept, batches of up to 100 files, crash/collision guards | Freeing disk space and a separate long-term retention policy |
| Checks | **1,294 tests / 65 files** at handoff, build/typechecks and lint passed; the local payment demo passed too. (Updated: 1,639 tests / 79 files after integration on 2026-10-09.) | These checks are not an external audit or public-network evidence |
| Customers | Criteria, interview script and pilot process prepared | Contacts, interviews, partner commitments and demand are not yet confirmed |

The new product is **not deployed** according to the last recorded checks. No
real burn/mint/payout/return has been sent. The last local funding snapshot:
**6 October, 17:37 Almaty**; four blockers — destination ETH for owner/customer
and oracle/operator, source ETH and source USDC. This is a historical snapshot,
not current balances; repeat the keyless preflight before any action.

The old public demo contracts and manifests v1/v2 do not replace the new product.
Priority runbooks: payment policy/operator, readiness, deployment acceptance and
first payment. `tripwire-pilot.md` describes the earlier v2 pilot.

Updated 2026-10-09: the policy v4 Sepolia deployment of 2026-10-03 (guardian
`0xF58C…fE0F`, owned by a Safe) is the live *bridge demo*; it is not a payment
escrow deployment. A payment pilot needs its own fresh deployment against a v4
guardian (ADR-046).

## First run from a clean clone

1. Check out `main` (originally `origin/codex/tripwire-route-limits`; the handoff
   commit `cc13777` was pushed and its remote SHA verified on 7 October). Read the
   next steps in the progress checkpoint.
2. Read `AGENTS.md`, then this file and the
   [operations runbook](tripwire-operations.md). Respect the read-only browser,
   bigint money, and the separate browser/standalone-operator boundaries.
3. Use a Node with `node:sqlite` (runbook: 22.13+). Verified environments: Node
   **24.19.0** with npm **11.17.0** (Azamat), and Node **22.22.2** (CI and the
   2026-10-09 integration). Install dependencies from the lockfile:

   ```sh
   npm ci
   npm test -- --maxWorkers=2 --minWorkers=1
   npm run build
   npm run lint
   npm run tripwire:payment:demo:local
   npm run dev -- --host 127.0.0.1 --port 5177 --strictPort
   ```

4. Open `http://127.0.0.1:5177/tripwire/operations`. Use the marked synthetic
   fixtures in `src/testing/fixtures/tripwire/`; they are not pilot receipts.
5. Record reproduced results, environment versions and any differences in a new
   note. There are no `typecheck`/`test:golden` scripts in package.json:
   typechecks run through the build, characterization is part of the test suite.

`.tripwire/`, `.env*`, wallets and SQLite are excluded from Git. A clean clone has
**no** local keys, concrete deployment package, receipt bundle, intent, journals,
funding reports or the author's screenshots. Do not try to run the missing
`.tripwire/pilot/payment-manifest.json` and do not look for private keys in Git
history. For your environment create separate test roles and a public
configuration version 3 per [payment operator](tripwire-payment-operator.md#deployment-package),
then a new package. To continue the earlier pilot specifically, agree a handover
of its public configuration/receipt/intent and account control outside Git; an
existing intent or journal must not be replaced just to make a run succeed.

## Where to continue in the code

| Task | Main files |
| :--- | :--- |
| Customer policy/return | `contracts/evm/src/CctpPaymentEscrow.sol`, `src/chains/evm/paymentPolicy.ts`, `scripts/tripwire/testnet/paymentState.ts` |
| Backing correctness | `src/chains/evm/cctp.ts`, `scripts/tripwire/cctp.ts`, `scripts/tripwire/sourceProof.ts` |
| Signatures/queue/restart | `scripts/tripwire/operator.ts`, `review.ts`, `store.ts`, `testnet/cctpOperator.ts`, `runCctpOperator.ts` |
| Risk inputs and HOLD | `src/tripwire/riskScorer.ts`, `scripts/tripwire/watch.ts` |
| Deployment/first transfer | `testnet/cctpDeployPlan.ts`, `cctpPreflight.ts`, `cctpDeploymentAcceptance.ts`, `cctpFirstPayment.ts` under `scripts/tripwire/` |
| Discovery/watch | `scripts/tripwire/testnet/cctpDiscovery.ts`, `cctpObserver.ts`, `observeCctp.ts`, `scripts/tripwire/discoveryState.ts` |
| Public files | `scripts/tripwire/testnet/reportArchive.ts`, `src/domain/reportFiles.ts` |
| Screen/import | `src/pages/TripwireOperations.tsx`, `operationsFeed.ts`, `src/chains/evm/operations.ts`, `src/domain/operations.ts` |

Contract artifacts are generated by the existing compiler and checked against it
in tests. Never edit bytecode by hand. Changing immutable contracts, the review
format, manifest/profile or journal scope requires an ADR, agreed compatibility,
and updates to the matching checks and runbooks.

## Implementation queue

### H1. Close the folder check in a real browser

This is the first small engineering step: the implementation exists, but
automation could not drive the native picker. It needs a manual smoke, not
another mock. (Updated 2026-10-09: an automated Chromium run with a real
`FileSystemDirectoryHandle` now covers everything after the picker; see the
progress checkpoint. The native dialog itself still needs a human.)

Create a separate folder for public synthetic reports only:

```sh
mkdir -p .tripwire/browser-smoke-public
cp src/testing/fixtures/tripwire/operations-worker-synthetic.json .tripwire/browser-smoke-public/observation-1000-00000000-0000-0000-0000-000000000001.json
```

In a supporting browser choose **Follow public report folder** and that folder.
Check the four synthetic rows and the original capture time. Then add:

```sh
cp src/testing/fixtures/tripwire/operations-worker-outage-synthetic.json .tripwire/browser-smoke-public/observation-1001-00000000-0000-0000-0000-000000000002.json
```

**Done:** after the next read the previous rows/anchors/coverage are gone and
unavailable plus retry state are shown; a newer healthy fixture brings the rows
back. Check a corrupted newest file, its deletion without fallback, revoking
permission, Disconnect, reload, manual import during an active subscription, an
unsupported browser and a narrow screen. Keep the old fixture timestamps: a stale
badge is expected here. Record the browser/version and screenshots clearly marked
synthetic. Do not substitute fixtures for real evidence and do not select a
folder that contains wallets.

### H2. Prepare observer operations

First define exit types: a retryable startup RPC failure separately from terminal
configuration/runtime/scope/quarantine/capacity/storage failures. At the time,
the generic CLI failure gave a supervisor no reliable classification. After that,
prepare and test a supervisor configuration for the team's environment; do not
restart every error forever. The repository template and its test are separate
from installing a service on a machine.

Add observability: no new reports, retrying, stopped/quarantined, backlog,
capacity and archive/storage failure. A staleness threshold must not turn stale
states into "fresh". Start with local incident records/output; sending external
alerts needs a specific agreed recipient and the team's permission.

**Done:** a process crash/RPC outage recovers with the same journal and without
repeated claims; terminal causes are not bypassed by restarts; stopping releases
the lease; metadata/errors do not reveal keys or credential-bearing RPC URLs.
Check a disk failure after commit and after publication, plus a new run against
the same state. Use the current observer/crash/archive fixtures as a base.

### H3. Run the real testnet workflow

The owner is a human-assigned operator who controls the test accounts. The
engineering preparation tools below are keyless/unsigned.

1. Prepare public configuration v3, separate owner/customer and oracle/operator
   roles, the deployment nonce and agreed test limits. Save the new plan and
   receipt template per [readiness](tripwire-testnet-readiness.md) and
   [acceptance](tripwire-deployment-acceptance.md). (Updated: the guardian must be
   policy v4, owned by a Safe, with the oracle separate from both relayers; ADR-046.)
2. Get testnet ETH on the relevant chains and test USDC on Base Sepolia. Repeat
   the preflight; a changed deployer nonce needs a whole new package, not a manual
   edit of one field. Do not treat nonzero ETH as a sufficient gas budget.
3. Send the four ordered deployment/configuration transactions with current
   simulations/fees; save the real hashes and reach finalized acceptance of the
   full runtime, receipt provenance, initial policy/accounting and grant history.
4. Prepare one first-payment intent per [first payment](tripwire-first-payment.md).
   Keep its operation ID and reserved burn nonce once actions start. The planner
   emits only the next unsigned step: allowance reset / exact approval / Standard
   burn. It is not a durable burn sender.
5. Separately provide controlled signing, a full Base fee budget, nonce and
   storage of the sent bytes/receipts. After the burn, wait for the actual mint;
   a second burn is not a way to speed up settlement.
6. Start the observer after acceptance. For durable discovery use real decimal
   source/destination start blocks, an empty manifest v3 and a separate journal:

   ```sh
   npm run tripwire:cctp:observe -- manifest.json observer.sqlite --discover-resume=SOURCE_START_BLOCK:DESTINATION_START_BLOCK --watch --interval=10 --reports=public-reports --keep-reports=500
   ```

   Replace the placeholders with real blocks. The signing operator uses its own
   journal and explicit receipt locators: handing discovery to signing is not
   implemented yet. One writer per journal and one owner per account nonce.
7. Record a normal payout, customer approval/delay, policy invalidation, pause,
   HOLD→retry, recovery request→maturity→fixed return and restart/outage. Separate
   receipt inclusion from finality and from operator-added latency.

**Done:** real canonical finalized burn/mint/payout/return receipts, exact
net-credit accounting and reproducible failure drills. Missing
baseline/pricing/screening keeps a HOLD. A synthetic baseline must not be passed
off as a live input just to get ALLOW. The current acceptance/first-payment checks
assume an unused initial state; after the first payment they do not replace an
ongoing operator audit. Do not reset old artifacts, scope or SQLite quarantine.

### H4. Separate mandatory policy from behavioral shadow signals

This is open product work, not an existing switch. First write an ADR/decision
matrix: which sources are mandatory, how to treat their outage, which heuristics
only inform, and when the customer explicitly allows their enforcement. Agree
operator/scorer/review/contract policy changes together.

H4c1 records the [concrete proposed specification](tripwire-behavioral-policy.md)
and ADR-045: customer consent, separate issuer/head/receipt screening, review/
execute commitments and new compatible versions. This is a design, not an enabled
mode. The next step, H4c2, is a pure read-only verifier; the exact task is in the
progress checkpoint.

**Done:** a missing/invalid mandatory source, mint, policy or screening never
becomes ALLOW; the reviewer cannot bypass recipient/amount/approval/pause/delay;
a customer policy change invalidates an old review. Shadow output does not promise
"safety" and does not grant execution permission. There are negative fixtures for
each row of the decision matrix and for version compatibility.

### H5. Prepare the source integration and the audit

List every outgoing path of the treasury account, the operator/owner rights and
the ways to bypass the escrow. The first planner allows an EOA; a smart/delegated
account needs a separate supported profile and review, not a hidden replacement of
the current check. Define the enforced limits of the automated sender and the
owner's remaining rights. Then give an external auditor a pinned commit,
compiler/artifact hashes, threat model, the chosen deployment configuration and
testnet evidence. (Started 2026-10-09: [audit package](tripwire-audit-package.md).)

**Done:** independent findings with reproductions, fixes and remediation review on
a specific commit; roles and bypass powers documented; no claim of "audit passed"
based only on local tests.

### H6. Find a design partner and confirm usefulness

Run this track in parallel with engineering. The founder assigns a discovery
owner; the team has indicated an audit/pilot budget, but there are no concrete
partners. Use the [partner workflow](tripwire-partners.md): 30 qualified
candidates, 12 interviews about real operations, 3 suitable candidates, 1 written
testnet pilot commitment. These are targets, not achieved results.

**Done:** a supported route, recurring pain, decision owner, access to agreed test
operations, acceptable delays/holds, time-saving metrics and stop criteria are
confirmed. Outreach is done by the assigned discovery owner; this repository sends
no invitations. Without a commitment after the interviews, revisit the hypothesis
rather than adding chains for the sake of activity.

## Limits that must not be lost when continuing

- Discovery: up to 4,096 new finalized blocks per tick per chain, 100 retained
  hints per chain. A capacity stop requires reconciliation; the JSON archive does
  not extend this cap.
- Lifecycle history: bounded scans; unavailable history is not replaced by a
  guessed payout hash/time. Source-only hints are not a proven unminted balance.
- Browser: max 2 MB / 1,000 payment rows / 2,000 folder entries; read-only,
  memory-only handles, no authenticated publisher or complete treasury inventory.
- Archive: opt-in 10–1,000 retained reports, at most 100 moves/tick and 10,000
  top-level entries. Tested on a local macOS filesystem; needs hard links and
  directory flush support. History is kept, so total disk usage keeps growing.
- RPC/Circle/admin trust remains. Scope/runtime equality is not a consensus light
  client, an audit of Circle's proxy implementation or an independent product audit.
- Mainnet: only after independent review, a recovered testnet credit, failure
  drills, an accepted source integration and partner-approved limits/runbook.

## How to deliver the next changes

Each stage is a separate reviewable commit/PR with the problem trigger, resulting
behavior, tests and concrete limits. Update `docs/05-roadmap.md` and the relevant
runbook together with the code; record any new architectural boundary in
`docs/07-decisions-adr.md`. Distinguish public facts from synthetic examples.
Never add secrets, wallets, signed outboxes or journals to Git, and never
force-add `.tripwire/`. Do not wipe state to get around errors or quarantine.

In the first follow-up, state: whether the baseline was reproduced; the result of
H1; who owns H2/H3/H5/H6; which acceptance gate is closed next. That lets work
continue on facts, without giving the impression of an already running live pilot.
