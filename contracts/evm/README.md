# Tripwire guardian — EVM

One contract, identical bytecode on Ethereum, Arbitrum, Base and Optimism: an
EIP-7265-style rolling outflow cap, plus oracle-driven route pausing for the
transfers a volume cap cannot see.

## Safety properties

Each is enforced by the contract and broken deliberately by a test.

| Property | Attack it closes |
| :--- | :--- |
| The oracle can pause, and nothing else | A stolen oracle key is a denial of service on the routes it attests against, never a theft |
| Every pause expires — HIGH 4h, CRITICAL 24h | An oracle cannot brick a route; the owner can resume early and rotate the key |
| A pause only moves forward | A low-score attestation cannot be used to lift a harder lockdown |
| EIP-712 domain binds chain id and address | A signature for Base cannot be replayed on the identical bytecode on Arbitrum |
| Nonces are single-use; TTL ≤ 10 minutes | A signed-but-unsubmitted attestation cannot be held back and fired later |
| OpenZeppelin ECDSA rejects high-`s` | No second valid signature exists for an accepted attestation |
| Unconfigured routes reject outflows | Fails closed on a route the guardian knows nothing about |
| Only allow-listed contracts report outflows | An outsider cannot inflate usage to force a route shut |

Tiers are strict: scores **76–90** pause for a 4-hour review, **91–100** lock
down for 24 hours, **≤ 75** and **> 100** revert.

## Verification

| Check | Result |
| :--- | :--- |
| Compiles, solc 0.8.37 | Clean — 0 warnings in our code (5 inside vendored OpenZeppelin) |
| Runtime size | 6001 bytes, against the 24576 EIP-170 limit |
| Executed in an EVM | **35 / 35 pass** against the freshly compiled bytecode |
| Mutation testing | **12 / 12 mutants killed** — every property above, broken on purpose, is caught |
| Foundry suite | 27 tests (2 fuzz), **type-checks clean** against the real contract and OpenZeppelin |
| Gas, measured | `onTokenOutflow` 34,104 warm (≈13k execution + 21k base); `submitAttestation` 61,655 |

The EVM suite (`test/*.evm.test.ts`) runs in `npm test` via `@ethereumjs/vm`.
It recompiles first, so it cannot pass against a stale artifact.

**What is not verified:** the Foundry suite has not been *executed*. This
machine has no Foundry, and installing it needs `curl | bash`. The type-check
proves its selectors, struct access, casts and argument types against the real
contract; it cannot prove forge-std runtime behaviour or run the fuzzers. Its
gas ceiling is extrapolated from the EVM measurement, not measured under forge.

## Running it

```bash
node contracts/evm/compile.mjs     # build, size, warnings
npm test                           # includes the EVM suite
```

Foundry, once installed:

```bash
cd contracts/evm
forge install foundry-rs/forge-std
forge test -vv
```

> **Do not `npm install forge-std`.** The npm package of that name is not the
> official library — it is published from an unrelated third-party repository
> and frozen at v1.1.2. The real one comes from `forge install`.

## Known issue — oracle and guardian disagree on the boundary

The TS oracle trips at `score >= 0.75` and floors deterministic signals to
exactly 0.75. The guardian pauses only on `riskScore > 75`. So the Verus case,
the oracle's most certain signal, maps to 75 and the guardian **refuses** it:

```
TS oracle, Verus case : score=0.75 verdict=TRIP
real contract says    : REVERTED ScoreBelowThreshold(75)
```

Pinned in `test/crossLayer.evm.test.ts` as `it.fails` — it passes while the bug
exists and will fail the moment it is fixed, so the fix cannot land unnoticed.
It belongs to Phase 2, which owns the 0..1 → 0..100 mapping. Recommended: a
deterministic signal is proof of a broken invariant, not an estimate, so floor
it to 1.0 (CRITICAL) rather than to the trip threshold.

## Solana

A native Anchor program, not a port — there is no EIP-7265 equivalent to extend.
PDA per route (`[b"route_guardian", route_id]`) holding `authority`,
`oracle_pubkey`, `sliding_window_outflow`, `window_start`, `threshold_cap` and
`paused_until`; instructions `initialize_route`, `record_outflow` and
`submit_attestation`, verifying the oracle via the Ed25519 instruction sysvar.
Not written: it needs the Rust and Anchor toolchains, also absent here.
