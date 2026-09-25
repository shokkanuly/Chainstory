# Tripwire guardian — EVM

One contract, identical bytecode on Ethereum, Arbitrum, Base and Optimism.

## What it is

An EIP-7265-style rolling outflow cap, plus the thing the base standard is
missing. The documented weakness of the reference design is that it only tracks
liquidity volume: a transfer that is suspicious for any other reason — a
proof/payout mismatch, a flagged counterparty, an abnormal pattern — passes
untouched as long as it sits under the dollar cap. `submitAttestation` is the
extension that closes that gap, driven by the risk oracle in `src/tripwire/`.

## The safety properties, and why they were chosen

| Property | Why |
| :--- | :--- |
| The oracle can pause, and nothing else | A stolen oracle key buys a denial of service on one route, never a theft. That is a trade a bridge operator can accept; "the oracle can move funds" is not. |
| Pauses expire after `MAX_PAUSE` | A pause is a timelock that buys a human review window, not a kill switch. If the oracle goes dark mid-incident the route resumes on its own rather than stranding funds. |
| Attestations bind `chainid` and `address(this)` | The same bytecode is deployed to four chains. Without this, a signature produced for Base is replayable on Arbitrum. |
| `s` is restricted to the lower half of the curve order | Otherwise a second valid signature exists for an attestation already marked used. |
| Only allow-listed contracts may report outflows | An unrelated caller could otherwise inflate a route's usage to force it shut. |

## State of the code

**Compiles clean** — solc 0.8.37, optimizer on, zero warnings, 3502 bytes
against the 24576 EIP-170 limit:

```bash
node contracts/compile.mjs
```

**Not yet behaviourally tested.** `compile.mjs` proves the contract builds; it
does not prove the pause, cap, expiry or replay logic behave. That needs an EVM
test runner, and this machine has no Foundry, Rust or Anchor toolchain and no
package manager to add one. Nothing here should be deployed until the test
suite below exists.

To set the intended toolchain up:

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
```

Then `forge init --force`, move `src/` across, and write `test/TripwireGuardian.t.sol`
covering, at minimum:

- an outflow under the cap succeeds; one over it reverts with `CapExceeded`
- the window rolls, and usage resets with it
- a valid attestation pauses the route and blocks the next outflow
- a pause expires on its own, and the next outflow clears it lazily
- an attestation replayed on the same chain reverts with `AttestationReplayed`
- an attestation signed for a different `chainid` or address fails
- a score under `TRIP_SCORE_BPS` reverts
- a non-allow-listed caller cannot record an outflow

## Solana

There is no EIP-7265 equivalent on Solana to extend, so the guardian is a
native Anchor program rather than a port: a PDA per route holding
`outflow_in_window`, `cap`, `paused_until` and the oracle pubkey, with
`record_outflow`, `submit_attestation` and an `is_paused` view. Same state
machine, same safety properties. Not written yet — it needs the Rust and Anchor
toolchains, which are also absent here.
