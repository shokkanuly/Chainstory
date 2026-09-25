# TripwireGuardian — EVM

One contract, identical bytecode on any EVM chain: an EIP-7265-style rolling
outflow cap, plus oracle-driven route pausing for the releases a volume cap
cannot see.

## Behaviour

- An attestation scoring **75 or more** (inclusive; out of 100) pauses its route
  for **24 hours**. Below 75, or above 100, it reverts.
- A fresh attestation restarts the 24 hours, so it can only extend a pause.
- The owner can resume early and rotate the oracle key.

## Safety properties

Each is enforced by the contract and broken deliberately by a test.

| Property | Attack it closes |
| :--- | :--- |
| The oracle can pause, and nothing else | A stolen oracle key is a denial of service on the routes it attests against, never a theft |
| Every pause expires after 24 hours | An oracle cannot brick a route |
| EIP-712 domain binds chain id and address | A signature for Base cannot be replayed against the same bytecode on Arbitrum |
| Nonces are single-use; validity ≤ 10 minutes | A signed-but-unsubmitted attestation cannot be held back and fired later |
| OpenZeppelin ECDSA rejects high-`s` | No second valid signature exists for an accepted attestation |
| Unconfigured routes reject outflows | Fails closed on a route the guardian knows nothing about |
| Only allow-listed contracts report outflows | An outsider cannot inflate usage to force a route shut |

## Verification

| Check | Result |
| :--- | :--- |
| Compiles, solc 0.8.37 | Clean — 0 warnings in our code (5 inside vendored OpenZeppelin) |
| Runtime size | 5622 bytes, against the 24576 EIP-170 limit |
| Executed in an EVM | **35 / 35** against the compiled bytecode |
| Mutation testing | **13 / 13** mutants caught — each property above, broken on purpose |
| Oracle ↔ guardian boundary | **9** cross-layer tests: the oracle trips exactly when the guardian accepts |
| Gas, measured | `onTokenOutflow` 34,082 warm; `submitAttestation` 60,753 |

Tests run in `npm test` through `@ethereumjs/vm` and viem — pure TypeScript, no
Foundry. They execute `src/tripwire/guardian.artifact.ts`, the same artifact the
dashboard runs in the browser, and a test fails if that committed artifact ever
differs from a fresh compile of this source. So the demo cannot be running a
contract nobody tested.

```bash
node contracts/evm/compile.mjs   # rebuild the artifact after changing the .sol
npm test
```

## The boundary bug this suite now guards

The oracle trips at `score >= 0.75`, and deterministic signals — proof of a
broken invariant — used to score exactly 0.75. The guardian first shipped
pausing only on `> 75`, so the oracle's most certain verdict mapped to 75 and
was **refused on-chain**. Every incident in the replay would have failed to
pause.

Fixed on both sides: the guardian's threshold is inclusive, deterministic
signals now score 1.0, and the 0..1 → 0..100 mapping floors rather than rounds
(rounding would lift 0.745 to 75 and pause on a transfer the oracle only rated
`elevated`). `test/crossLayer.evm.test.ts` checks scores on both sides of the
boundary against the real contract, and the mutant that restores the strict
threshold fails four tests.
