# Demo video script — Tripwire

Two cuts of the same story: a **2:30 demo** (the main video) and a **1:00 pitch**
that reuses its first shots. Every claim is tested in the repo or visible on
screen. The replay uses synthetic inputs, and the payment escrow runs on a
local EVM; the script says so out loud.

Record the screen with QuickTime (File → New Screen Recording) at 1280×800 or
larger, dark theme, browser zoom 100 %. Record the voice separately if that is
easier, then lay it over the clips.

## Before you record

Open these tabs, in this order, so each cut is one click:

1. <https://chainstory-iota.vercel.app/>, scrolled to the top. Wait for the silk background to settle.
2. <https://chainstory-iota.vercel.app/tripwire?incident=kelp>, paused at T+00:00, speed 2×.
3. A terminal in `~/Desktop/Chainstory`, font 16 pt or larger, cleared, with
   `npm run tripwire:demo:local` typed but not run.
4. A second terminal tab with `npm run tripwire:payment:demo:local` typed but not run.
5. The guardian on Sepolia:
   <https://sepolia.etherscan.io/address/0xf58c0711fed0f425383e5d07345880488889fe0f>.
6. <https://chainstory-iota.vercel.app/tripwire/operations>.

Run both terminal commands once beforehand so the first run in the recording
is fast. Hide bookmarks, notifications and anything with a key in it.

## Main cut: 2:30

| Time | On screen | Voice-over |
| :--- | :--- | :--- |
| 0:00–0:12 | **Tab 1.** The hero: "Every payout. Prove it first." The example card is cycling. | "Cross-chain payments are released on trust. The bridge says the money was burned on one chain, and the other chain pays out. In 2026, three bridges paid out money that was never burned." |
| 0:12–0:30 | Hover over the payment card to stop it, click **Verified payment**, then **Missing evidence**, then **Screening match**. | "Tripwire puts evidence in front of the payout. Before release, it checks that the source burn really happened and matches this payment, that screening passed, and that the customer's own rules allow it. If any check is missing or wrong, the payment is held, with the reason." |
| 0:30–0:42 | Scroll slowly through *The payment path* (Burn → Credit → Verify → Resolve) and the four control cards. | "Burn, credit, verify, resolve. And if a payment is held, the customer has a fixed way back: a delayed return to an address they committed to up front." |
| 0:42–1:12 | **Tab 2.** Press **Play** on the Kelp replay. Point at the "Model · before execution" tile staying at $0 while "after inclusion" climbs. Toggle **Before execution / After inclusion** on the Routes panel. | "Timing is everything. This replay runs our compiled guardian contract in a local EVM in your browser, with synthetic inputs modelled on the Kelp DAO incident. A guardian that acts before execution holds the forged payout. One that reacts after inclusion is one block too late, and only the attacked route pauses. The rest of the bridge keeps running." |
| 1:12–1:40 | **Tab 3.** Run `npm run tripwire:demo:local`. Let the four steps print, then stop on step 3: *NO BURN → FREEZE*. | "The response is graduated. An ordinary payout goes through. A payout to a brand-new, unverified, upgradeable contract is throttled. A burst is delayed. A forged payout with no burn behind it freezes the route, and the review explains why: no verified backing, a one-day-old contract, 136 times this route's normal size." |
| 1:40–1:52 | **Tab 5.** Scroll the guardian's transactions on Sepolia Etherscan. | "The same guardian is live on Ethereum Sepolia testnet. Every attestation and every blocked payout is a transaction you can open." |
| 1:52–2:14 | **Tab 4.** Run `npm run tripwire:payment:demo:local`. Stop on the accounting line. | "On top of it, we built a payment escrow for Circle's CCTP USDC. Here it is on a local chain: an ordinary payment pays once. A large one needs the customer's approval and a delay. An unpermitted recipient gets its money returned. A policy change stops an old approval. And the accounting adds up to the last base unit." |
| 2:14–2:24 | **Tab 6.** Click **Explore example report**. Scroll the payment states and hold reasons. | "Operators see every payment's state and why it is held, from a read-only report. The website can't sign or move anything." |
| 2:24–2:30 | **Tab 1**, back at the top, URL visible. | "Tripwire. Every payout, proven first. Live on Sepolia testnet, open source, at chainstory-iota.vercel.app." |

About 360 spoken words, a calm pace for 2:30. If you run long, cut the 0:30–0:42 scroll first.

## Short cut: 1:00 pitch

| Time | On screen | Voice-over |
| :--- | :--- | :--- |
| 0:00–0:10 | Tab 1, the hero, with the card cycling | "In 2026, three bridges paid out money that was never burned. Every defence today reacts after the payout lands." |
| 0:10–0:25 | Tab 2, press Play; the before-execution tile stays at $0 | "Tripwire checks each payout before it executes: is it backed by a burn we can verify? In our replay, acting before execution holds the forged payout; one block later is too late." |
| 0:25–0:40 | Tab 3, step 3 of the local demo: NO BURN → FREEZE | "It's graduated: throttle, delay, freeze. Only the attacked route pauses, and every hold comes with its reasons." |
| 0:40–0:52 | Tab 5, Sepolia Etherscan | "It's live on Ethereum Sepolia testnet, and a CCTP USDC payment escrow with customer rules and screening is built and tested." |
| 0:52–1:00 | Tab 1, URL visible | "Tripwire: every payout, proven first. chainstory-iota.vercel.app." |

## Say the limits before a judge asks

If there are 10 seconds to spare, add this at the end of either cut: "It's
testnet only and not externally audited yet. The screened payment escrow runs
locally; deploying it and a real screening provider come next."

## Words to avoid

- "Prevented $292M" or "would have saved". The replay is a reconstruction with synthetic inputs, not the original transactions.
- "Mainnet", "audited" or "production".
- "Retold" and `/check`: they are no longer on the site, and `/check` redirects to the home page.
