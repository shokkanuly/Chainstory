# TripwireGuardian — EVM

One contract, identical bytecode on any EVM chain: an EIP-7265-style rolling
outflow cap, plus an oracle-driven, graduated response for the releases a
volume cap cannot see.

## Behaviour

- An attestation (a score out of 100, thresholds inclusive) sets a tier on its
  route for **24 hours**. Below 65, or above 100, it reverts.

  | Tier | Score | Effect |
  | :--- | :--- | :--- |
  | THROTTLE | ≥ 65 | The window cap is halved |
  | DELAY | ≥ 85 | The cap stays halved, and any outflow above 10% of the cap is held for 30 minutes |
  | FREEZE | ≥ 95 | Every outflow reverts |

- Tiers only escalate while active: a lower score is accepted but ignored. A
  same-tier attestation extends the 24 hours without reopening DELAY's 30-minute hold.
- Reconfiguring a route's cap leaves its tier in place. Only the owner's
  `resume` lifts a tier early, and it clears everything. The owner can also
  rotate the oracle key.

## Safety properties

Each is enforced by the contract and broken deliberately by a test.

| Property | Attack it closes |
| :--- | :--- |
| The oracle can tighten a route, and nothing else | A stolen oracle key is a denial of service on the routes it attests against, never a theft |
| Every tier expires after 24 hours | An oracle cannot brick a route |
| EIP-712 domain binds chain id and address | A signature for Base cannot be replayed against the same bytecode on Arbitrum |
| Nonces are single-use; validity ≤ 10 minutes | A signed-but-unsubmitted attestation cannot be held back and fired later |
| OpenZeppelin ECDSA rejects high-`s` | No second valid signature exists for an accepted attestation |
| Unconfigured routes reject outflows | Fails closed on a route the guardian knows nothing about |
| Only allow-listed contracts report outflows | An outsider cannot inflate usage to force a route shut |

## Verification

| Check | Result |
| :--- | :--- |
| Compiles, solc 0.8.37 | Clean — 0 warnings in our code (5 inside vendored OpenZeppelin) |
| Runtime size | 6,819 bytes, against the 24,576 EIP-170 limit |
| Executed in an EVM | **53 / 53** against the compiled bytecode |
| Mutation testing | **14 / 14** mutants caught — each tier property broken on purpose (`npm run test:mutants`) |
| Oracle ↔ guardian boundary | **12** cross-layer tests, reading the thresholds from the bytecode: 64/65, 84/85, 94/95 |
| Gas, measured | `onTokenOutflow` 36,704 warm; `submitAttestation` 84,485 |

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
