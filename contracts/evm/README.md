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

### Release-gated demo vault

`TripwireDemo.sol` now adds an independent execution gate to `ProtectedVault`.
Requests begin PENDING. An oracle-signed review can ALLOW, HOLD or terminally
REJECT a request; only a fresh ALLOW can execute. EIP-712 binds the message,
route, token, recipient, bigint amount, decision, required minimum guardian tier,
expiry and monotonically increasing per-message nonce to this vault and chain.
Older ALLOW reviews cannot overwrite newer HOLD reviews. A rotated oracle
invalidates existing execution allowances. The required tier must still be active
when execution runs, and SafeERC20 failures roll back the payout.

The guardian's tighten-only properties below apply to **route attestations**.
The release reviewer additionally permits already requested payouts. A production
bridge must independently authenticate messages and source backing; a review is
not that proof. The mock source still emits synthetic burns without burning tokens.

The local demo executes these contracts in the EVM. The older Sepolia vault has
no gate and must be redeployed before running the latest testnet scripts. The
browser incident replay executes the guardian, not the gated vault.

`test/releaseSafety.evm.test.ts` covers 23 execution/signature regressions.
`npm run test:mutants` also breaks seven review properties deliberately, separately
from the 14 guardian tier mutants. See [the active plan](../../docs/plans/tripwire-hardening.md).

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

## Authenticated CCTP escrow

`CctpEscrow.sol` inherits the tested review/guardian gate and owns itself. The
only path to a new PENDING request calls Circle's MessageTransmitter in the same
transaction, requires an exact net USDC balance increase, and takes the immutable
beneficiary from the authenticated hook. The source burn must restrict
`destinationCaller` to the escrow, so a direct relay cannot strand a mint without
a request. Source/destination route fields, known versions, standard finality,
canonical EVM addresses, fee/expiration, payload hash and nonce are bound.
Execution still needs a fresh Tripwire review and the guardian's approval.

The separate operator artifact has a 9,422-byte runtime, below EIP-170. It is not
imported by the browser and does not contain the test attester harness. Tests cover
42 EVM regressions plus artifact consistency; eight added mutation cases verify
the new guards. `npm run test:mutants` runs 29 cases in total and restores all
source/artifact files after completion. Circle quorum verification remains the
real Circle contract's responsibility; our one-signer local harness is a fixture.
No public deployment or live transfer is claimed. Rejected credits stay locked;
there is no administrator withdrawal/refund escape hatch. See the
[CCTP runbook](../../docs/plans/tripwire-cctp.md) and ADR-018 for deployment and
legacy-policy migration constraints.

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
