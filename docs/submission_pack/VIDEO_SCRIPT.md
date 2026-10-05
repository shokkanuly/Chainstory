# 1-minute video script — Retold · Tripwire

About 150 spoken words. Every claim below is either tested or sourced in the
README; nothing here is roadmap. Record the screen with QuickTime
(File → New Screen Recording) and add the voice-over while recording or after.

## Before you record

Open these tabs, in this order, so each cut is one click:

1. <https://chainstory-iota.vercel.app/tripwire?incident=kelp>
2. Terminal in `~/Desktop/Chainstory`, with `npm run tripwire:demo:local` typed and not yet run.
   It prints the same four steps as the Sepolia run, in seconds.
3. The guardian on Sepolia: <https://sepolia.etherscan.io/address/0xf58c0711fed0f425383e5d07345880488889fe0f>
4. <https://chainstory-iota.vercel.app/check>

## Script

| Time | On screen | Voice-over |
| :--- | :--- | :--- |
| 0:00–0:08 | Tab 1: the Kelp DAO replay, paused on the drain | "In April, 292 million dollars left Kelp DAO's bridge in a single transaction. Every defence today acts after the transaction lands." |
| 0:08–0:18 | Press Play; the "before execution" tile stays at $0 | "Tripwire scores each bridge payout *before* it executes. Replayed against three real exploits, acting before execution lets nothing out." |
| 0:18–0:36 | Tab 2: run the command; the four steps print | "And it's graduated. An ordinary payout: nothing happens. A payout to a brand-new, unverified, upgradeable contract: throttle. A burst to it: delay. A forged payout with no burn behind it: freeze." |
| 0:36–0:44 | Tab 3: scroll the guardian's transactions | "That same run is live on Sepolia. Every attestation and every blocked payout is a transaction you can open." |
| 0:44–0:54 | Tab 4: click the green scenario, then the red one | "For wallet users, Retold checks a transaction before you sign it: a normal transfer, green. An unlimited approval to a day-old unverified contract, red, with the reasons." |
| 0:54–1:00 | The site's home page, URL visible | "Nothing to connect, nothing to sign. Open source, and tested. Retold and Tripwire: chainstory-iota.vercel.app." |

## If you have 10 more seconds

Say the limit before a judge asks: "On Sepolia today one key signs the
attestations; a k-of-n quorum oracle is built and tested, and installing it is
next."
