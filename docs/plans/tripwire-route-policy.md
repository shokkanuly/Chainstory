# Route isolation, rolling limits and request delay (ADR-020)

Implemented locally on 2026-10-01. This changes immutable contract behavior and
the operator's signing policy. It has not been deployed on a public chain.

## Route permissions

`setProtected(caller, routeId, allowed)` grants/revokes one caller/route pair.
`isProtected(caller, routeId)` exposes that pair. There is no global grant or
legacy overload. Several reporters on one route share the same budget; allowing
a reporter on one route does not let it spend or exhaust another route's budget.
Each vault/escrow still has one immutable route and asset; route IDs must identify
the accounting unit as well as the bridge path. Authorized reporters remain
trusted to report their own outflows; isolation does not authenticate those reports.

The deployment runner, local fixtures and browser's in-process incident replay
now explicitly grant their own route. The browser remains read-only with respect
to public networks.

## Conservative rolling cap

The former fixed window could accept a full cap immediately before its reset and
another immediately after. The new guardian keeps 17 route-specific buckets.
Their width is `ceil(windowSeconds / 16)`. A bucket's entire amount remains counted
until one full window after its last accepted outflow. A failed payout records no
usage, and zero-amount reports are rejected.

This is deliberately conservative: all outflows in the last window count, and
an older outflow may remain counted for at most `ceil(windowSeconds / 16) - 1`
additional seconds. For a one-hour window this is at most 224 seconds. It is not
an exact timestamp queue or a weighted estimate that can undercount a boundary
burst. The ring has bounded storage and every check reads at most 17 buckets,
regardless of the number of transfers. A slot's 17-bucket reuse interval exceeds
the window plus a bucket width, so no live bucket is overwritten.

THROTTLE and DELAY still halve the cap. Their escalation may put existing usage
above the new cap; new spending then waits for usage to age out. `resume`, cap
updates, caller revocation and tier expiry never erase spend. The configured
window length cannot be changed: doing so would reinterpret retained history.
Changing the window requires a separately reviewed deployment/migration policy.
The owner can still raise a cap explicitly; this trusted power is unchanged.

`rollingUsage` and `routeStatus` age usage out in views without a write. `getRoute`
keeps its existing tuple shape; `outflowInWindow` now reports this current rolling
usage and `windowStart` is the initial configuration time, not a reset clock.
An unconfigured route and a halved cap of zero report RATE_LIMITED. FREEZE still
reports PAUSED and rejects every payout.

Local gas measurements: about 79k for a warmed outflow check, versus the old 37k;
the populated-ring regression has a 120k ceiling. A fresh guardian runtime is
7638 bytes and the inherited CCTP escrow runtime is 10033 bytes, below EIP-170.

## Per-request DELAY

The route-wide first 30-minute DELAY window remains in the guardian hook for
generic reporters. Vaults additionally use `outflowDelay(routeId, amount)` and
the separate `releaseDelayUntil(messageId)` mapping. Under active DELAY, the
first ALLOW of a request above 10% of the configured cap starts its own 30-minute
clock. This applies even when the route's original hold is already over, and
even when that ALLOW uses minimumTier NONE. Smaller requests remain payable
under the shared halved rolling cap; splitting requests does not create new budgets.

Retries, fresh reviews and HOLD→ALLOW do not restart or shorten an established
request clock. A request cannot borrow another message's elapsed clock. Owner
route resume and a lower fresh minimumTier do not cancel its existing delay.
If a previously clear review encounters DELAY without a request clock, execution
rejects with RequestDelayNotStarted until a fresh ALLOW starts one.

Delay is not permission to pay: the vault still requires a nonexpired ALLOW,
current reviewer, sufficient guardian tier and available rolling budget. Review
TTL is at most ten minutes, so an initial ALLOW normally expires during the
30-minute hold. A fresh risk/source assessment and review are required before
retrying at maturity. HOLD can revoke ALLOW immediately, and REJECT stays terminal.
This policy is inherited by authenticated CCTP credits without changing their
mint/beneficiary/amount binding.

The durable operator reads request, delay and clock at one hash-checked latest
block, refusing a head behind an observed write receipt. While ALLOW remains
justified but a verified request's clock has not matured, it retains the queue
without signing another ALLOW or simulating a payout. Risk, source health and
route protection are still reassessed each tick; HOLD/REJECT are not deferred.
At maturity it follows the existing fresh-review → simulate → execute path.
Source guards, quarantine, original-byte recovery and finalized acknowledgement
remain in force. Legacy fixture ports without delay metadata retain their old
retry behavior; the real RPC port always reconciles delay metadata.

## Compatibility and rollout

Guardian policy marker and vault release policy marker are both 2; release-review
EIP-712 domain version is now 2. Historical version-1 reviews cannot authorize a
new policy. Before opening a signing lifecycle, the RPC operator verifies both
markers and the vault's explicit route permission. The testnet demo makes the
same checks before reset/payout writes, and refuses recent rolling usage instead
of pretending configuration can clear it. Marker getters validate the trusted
deployment manifest; they are not proof of arbitrary bytecode authenticity.

Existing contracts cannot be upgraded in place. A fresh deployment requires
explicit reconciliation of outstanding funded credits, pending requests and
signed work; do not discard/reset an old journal or silently redirect it. New
addresses are bound by the existing store scope, so no database schema migration
or automatic credit transfer is supplied. Read-only historical CCTP source audits
remain possible; they do not attest the new release policy. External review and
the deployment/observe-only pilot remain pending.

Validation: four genuine regressions failed before the fix; 42 new tests cover
cross-route/shared/revoked permissions, boundary bursts, conservative expiry,
three rolling-window models over 80 calls each, configuration/tier changes,
uint128 limits/gas, sticky request clocks, old-domain rejection, CCTP inheritance,
deployment/RPC failures and durable delay restart/review policy. The full suite
has 609 tests. Nine new contract mutation cases exercise these guards.
