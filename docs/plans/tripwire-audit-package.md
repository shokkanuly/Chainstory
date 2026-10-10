# Tripwire: external audit package (H5)

Prepared 2026-10-09 for an independent reviewer. **No external audit has been
done.** This file gives an auditor the scope, exact build, roles, bypass paths
and evidence, so the review can start without a walkthrough. The team still has
to choose a vendor and pin the final commit. The trusted-setup and source-permission
questions at the end need answers from the people who will run a pilot.

## Scope

| Component | Files | Lines | Why it matters |
| :--- | :--- | ---: | :--- |
| Guardian, policy v4 | `contracts/evm/src/TripwireGuardian.sol`, `ITripwireGuardian.sol` | 487 | Per-route caps, graduated tiers, oracle rotation and kill switch |
| Release gate | `contracts/evm/src/TripwireDemo.sol` (`ProtectedVault`) | 218 | Signed per-release review, REJECT hold, delays |
| CCTP escrow | `contracts/evm/src/CctpEscrow.sol` | 122 | Credits only from an authenticated Circle mint, exact net amount |
| Customer payment escrow | `contracts/evm/src/CctpPaymentEscrow.sol` | 290 | Customer policy, approvals, delay, pause, fixed return, accounting |
| Screened payment escrow | `contracts/evm/src/CctpScreenedPaymentEscrow.sol` | 258 | Issuer-signed screening receipts and list heads, checked at review and execution; consent queue (ADR-047) |
| k-of-n oracle | `contracts/evm/src/TripwireQuorum.sol` | 114 | ERC-1271 threshold signer that can replace the single oracle key |
| Off-chain operator | `scripts/tripwire/operator.ts`, `watch.ts`, `settlement.ts`, `review.ts`, `sender.ts`, `store.ts`, `cctp.ts`, `sourceProof.ts`, `rpcQuorum.ts`, `testnet/operator.ts`, `testnet/cctpOperator.ts`, `testnet/paymentState.ts` | — | Decides and signs reviews; crash-safe journal; source/settlement proofs |
| Operator screening | `scripts/tripwire/screeningGate.ts`, `testnet/screenedState.ts`, `testnet/screeningInbox.ts`, `src/chains/evm/screening.ts` | — | Fetches, journals and verifies issuer evidence before a format-4 ALLOW; advisory mode from on-chain consent (ADR-048) |

Out of scope unless the client asks: the browser app, the Retold wallet reader,
the demo token/bridge contracts (`DemoUSDC`, `MockSourceBridge`, `DrainReceiver`),
Circle's own contracts and attestation service, and OpenZeppelin libraries.

## Exact build

- Compiler: solc `v0.8.37+commit.f401782d`, optimizer on, 200 runs, EVM `cancun`
  (`SOLC_SETTINGS` in `contracts/evm/compile.mjs`). Regenerate everything with
  `node contracts/evm/compile.mjs`; tests fail if a committed artifact differs.
- Pin: the commit that carries this file into `main`. Record its full SHA in the
  engagement letter. Any later change to `contracts/evm/src` needs a new pin.
- Creation code (initcode) fingerprints at this commit, `keccak256(bytecode)`.
  Deployed runtime differs per deployment because of immutables; the operator
  rebuilds the exact expected runtime from `cctpAcceptance.artifact.ts` (ADR-030).

| Contract | Initcode bytes | keccak256(initcode) |
| :--- | ---: | :--- |
| TripwireGuardian | 10,876 | `0xd41e6556127ed214f90d9f926df8c6b65da41f08bfe12908e8e1b0b2f9231480` |
| ProtectedVault | 8,402 | `0x494e6765ebfc4f977eb7fe6a92ee8b858962790d7b4354d815948d26c1713c4d` |
| CctpEscrow | 12,638 | `0x05d7bf9676eb2f7c3fa47d6d64b118ffc777b1a4fce56eb32872b534ecf05910` |
| CctpPaymentEscrow | 20,308 | `0x69f29e9ea02234cbe82005c42bfe77d58d85d229695ddd3e7b2da83fdb286cf9` |
| CctpScreenedPaymentEscrow | 28,747 | `0x882363ac355d23c254a6db3709646a2591d41cbf6570d9eb53c7d766d5af4265` |
| TripwireQuorum | 5,968 | `0xf31917bf8a71dc62cc0396f74620c45a00188b3120a80d9ddf204e343e1fd094` |

Runtime sizes: guardian 9,599 bytes, CCTP escrow 10,434, payment escrow 16,309,
screened payment escrow 23,430 (EIP-170 limit 24,576: little room left).

## Roles and their powers

| Role | Can | Cannot | Mitigation in code |
| :--- | :--- | :--- | :--- |
| Guardian owner (a Safe) | Configure caps/windows; grant or revoke a reporter per route; propose, cancel or kill the oracle; resume a route; re-arm protection | Raise a cap while a route is protected; swap the oracle instantly | Ownable2Step; 2-day rotation notice; `disableOracle` also cancels a pending rotation (INT-1) |
| Oracle (key or `TripwireQuorum`) | Sign attestations (tighten a route) and release reviews (ALLOW/HOLD/REJECT) | Loosen a tier; keep a route protected past 72 h without a 24 h gap; pay an address other than the request's recipient | Escalate-only tiers; `MAX_ORACLE_PROTECTION`, `PROTECTION_COOLDOWN`; review binds recipient and amount |
| Relayers (two keys) | Pay gas to submit what the oracle signed, on separate nonce lanes | Sign anything that moves money | Signatures are verified on chain; ADR-026 |
| Customer authority (payment escrow) | Approve a payment; pause; revoke a recipient (instant); schedule a looser policy, recipient or unpause (1-day queue) | Redirect a return; skip the queue for loosening changes; be the oracle | `POLICY_CHANGE_DELAY`; return recipient immutable; constructor refuses authority == oracle |
| Return recipient (payment escrow) | Request a return of an unpaid credit, completed after `recoveryDelay` | Choose where it goes; take another credit | Return goes only to the fixed recipient bound in the authenticated CCTP hook |
| Anyone | Relay a Circle message into the escrow; apply a matured queued change; complete a matured return; accept a matured oracle rotation | Create a credit without a Circle mint to the escrow; change what was queued | `receiveCctp` checks the attested message and the exact balance change |

## Paths that bypass Tripwire (must be documented per customer)

Tripwire protects payouts **through the configured escrow** only. A reviewer
should confirm, and a customer must accept, that these remain outside it:

1. Direct transfers from the treasury account, or CCTP burns with another mint recipient.
2. Another bridge, or Circle's Fast transfer mode (refused by the adapter, so it never creates a credit).
3. The treasury owner changing its integration or permissions off-chain.
4. The guardian owner's own powers above (it can resume a route, re-arm protection and rotate the oracle with notice).
5. Circle's attester and contracts, and the RPC providers the operator reads (partly reduced by the multi-RPC quorum, ADR-022).

A full-flow guarantee needs source-side permissions that force the automated sender
through the escrow. The first planner allows an EOA sender; a smart or delegated
account needs its own reviewed profile.

## What to look at first

From the product plan's review brief, in order of money at risk:

1. Credit creation: Circle message parsing, `destinationCaller`, exact net amount,
   replay of a nonce or a business operation ID, unrelated depositors.
2. Payout gates: review signature domain/format (formats 2 and 3), nonce order,
   TTL, policy version binding, approval, delay, pause, recipient permission.
3. Payout and return races: return requested during an ALLOW or a delay, return
   after REJECT, reentrancy through the token, accounting
   `credited = outstanding + paid + returned`.
4. Owner and oracle powers: rotation timing, kill switch, protection span and
   cooldown, cap changes during protection, route isolation.
5. Screening (if in scope): issuer receipt and head verification, the transient
   review binding in `reviewScreenedRelease`, execution recheck, consent queue;
   off chain, the gate's coherent read, journal-before-sign, contradiction
   retention and the advisory switch (it must follow only on-chain consent).
6. Operator: crash between signing and broadcast, same-nonce replacement,
   finality conflicts and quarantine, RPC disagreement, policy read at one block.

## Evidence already in the repository

- Tests run the compiled bytecode in an in-process EVM: `npx vitest run`
  (1,639+ tests at integration; see the progress checkpoint for the current count).
- Mutation suite: `npm run test:mutants` breaks each promised property and
  requires a failing test.
- Self-audit (October 2026): CRIT-1/2, HIGH-1/3, MED-1 and the integration finding
  INT-1, each with a regression test (`contracts/evm/test/auditRegression.evm.test.ts`,
  ADR-024–027, ADR-046). This is not an independent review.
- Live demo on Sepolia (policy v4, owned by a Safe): `scripts/tripwire/testnet/deployment.sepolia.json`.
  The payment escrow is **not** deployed anywhere public.

## Questions the team must answer before the engagement

- Who owns the guardian Safe, the oracle key or quorum members, and the relayers?
- Which customer authority (EOA, Safe, smart account) and which return recipient?
- Which source sender, and what stops it from sending around the escrow?
- What exposure limit, delay tolerance and stop conditions does the first pilot use?
- Which screening provider and issuer (ADR-045) — or is screening out of scope for v1?

## Deliverables we ask for

Prioritized findings with reproductions; a remediation review on a pinned commit;
a checked artifact/configuration list; the residual trust assumptions; and the
deployment limits the reviewer would put on a first real-money pilot.
