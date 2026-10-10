# Colosseum form — Tripwire

Copy-paste answers for the Colosseum project editor, checked against the code
on `main` (2026-10-05). Every number here is in the README. Character counts
are under each field's limit.

Merge the integration-review PR first: the "749 tests" and "63 mutants"
figures below include it.

## Fields to fix

| Field | Change |
| :--- | :--- |
| Project website | `https://chainstory-iota.vercel.app/tripwire` — `retold-nu.vercel.app` was the old Vercel project and now returns 404 `DEPLOYMENT_NOT_FOUND` |
| Live product link | `https://chainstory-iota.vercel.app/tripwire?incident=kelp` (opens straight on the replay) |
| Which chains | Ethereum L1 and Base only. Untick Arbitrum and remove Optimism: nothing is deployed or verified there |
| Category | Infrastructure (or Security, if listed) — not Consumer Apps |
| Mobile-focused dApp | Untick: it is a web app, not a mobile dApp |
| Demo video | Required. Script: [VIDEO_SCRIPT.md](VIDEO_SCRIPT.md) |
| Team | Add Azamat and mauyaa under Manage team, or keep the disclosure below |

## Brief description (453/500)

```text
Tripwire is a circuit breaker for bridges that acts before the money moves. Every major 2026 bridge drain — Kelp DAO $292M, Verus $11.58M, Syscoin ~$10M — was a single transaction, so defences that react afterward are too late. Tripwire checks each payout before it executes: is it backed by a source-chain burn we can independently verify? If not, it tightens just that route (throttle, delay or freeze) while a human reviews. Live on Ethereum Sepolia.
```

## What are you building, and who is it for? (906/1000)

```text
Tripwire is an off-chain risk oracle plus an on-chain guardian contract, for teams that run bridges and cross-chain vaults.

Before a bridge releases funds, the oracle checks one invariant: is this payout backed by a finalized source-chain burn, which it can cross-check across independent RPC providers? It also scores the payout against the route's normal size and withdrawal velocity, and screens the recipient (contract age, verified source, upgradeable proxy). It signs an EIP-712 attestation and the guardian tightens just that route in proportion: THROTTLE, DELAY or FREEZE, never the whole bridge. Every tier expires on its own, so a faulty oracle cannot lock funds forever.

The owner is a Safe multisig, the oracle key can only sign, an oracle change waits 2 days, and the owner has a kill switch. A k-of-n quorum oracle is built and tested.

The site replays three real 2026 exploits against it.
```

## Why did you decide to build this, and why build it now? (963/1000)

The previous answer hit the 1000-character limit mid-word ("ChainStory's mul").

```text
Bridges lost $328M to hacks by mid-May 2026, and they produce the largest single losses in crypto. Each drained in one transaction. Chainalysis on Kelp DAO: "the main theft was executed in a single release."

Rate limits, emergency pauses and security councils all act after a transaction lands, which against these attacks is too late by definition. Even the Arbitrum Security Council's freeze two days after Kelp, which Chainalysis called unusually fast, only recovered part of what had left.

So the gap isn't slow humans. It's that nothing checks before execution. That is what Tripwire does. It reuses ChainStory's multi-chain reader and contract risk checks, which we had already built, and adds the guardian contract, the oracle and an operator that survives crashes and chain reorgs.

Why now: cross-chain volume keeps growing, and stablecoin rails like Circle's CCTP move real money between chains every day. Tripwire already verifies CCTP v2 USDC burns.
```

## How does your product use these chains? (421/500)

The previous answer said the guardian is deployed on Ethereum, Arbitrum, Base
and Optimism, and that the oracle reads history through Etherscan's API. Neither
is true: it is deployed on Sepolia only, and burns are read from finalized
chain logs over RPC (the explorer is used only to screen recipients).

```text
The guardian and a demo bridge vault are deployed on Ethereum Sepolia (testnet): every attestation and blocked payout there is a real transaction. The CCTP v2 operator verifies USDC burns on Base Sepolia before a mint on Ethereum Sepolia is released. EIP-712 binds each attestation to one chain and one contract, so a signature cannot be replayed elsewhere. The contract is plain EVM; mainnet and L2 deployments are next.
```

## Did anyone not listed on the team do meaningful work? (489/600)

The previous answer said "I am the sole builder"; the git history shows two
other contributors. If you add both to the team, drop the second sentence.

```text
Yes. Two collaborators contributed code through pull requests, all visible in the public git history: Azamat (GitHub azimxxd) built the crash-safe operator queue, reorg recovery, route payout limits, protection refresh and the CCTP USDC backing checks; mauyaa built the k-of-n quorum oracle, multi-RPC proof checks and the settlement verdict. The repo predates the hackathon (ChainStory, July 2026); the Tripwire work starts 14 September. I used AI coding assistance (Claude Code) heavily.
```

## Anything else judges should know? (465/500)

The previous answer said "13 safety properties" and "not yet on a live chain".

```text
One public repo. Commits before 14 September are pre-hackathon ChainStory; Tripwire was built in the competition window. The guardian is tested by running its compiled bytecode in an EVM: 749 tests, and all 63 deliberately injected bugs (mutation tests) are caught. We ran our own security audit and fixed every finding. Live on Ethereum Sepolia, not mainnet, and not externally audited yet. Incident replays are reconstructions; every source is listed on the page.
```

## Important context about your repo (448/500)

```text
Monorepo for two products on one engine: Retold (wallet history reader and 'check before you sign') and Tripwire (bridge payout guardian), the hackathon entry. Tripwire lives in contracts/evm (Solidity guardian, vault and quorum, with tests), scripts/tripwire (oracle and operator) and src/tripwire (scorer and incident replay). README has a judge's quick-start; the Sepolia deployment record is in scripts/tripwire/testnet/deployment.sepolia.json.
```
