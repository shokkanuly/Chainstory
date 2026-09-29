# Launch posts: X, Instagram, Threads

The link for every post is **https://chainstory-iota.vercel.app**. If you add
a custom domain, change `SITE` in `docs/social/posters.mjs`, run
`node docs/social/posters.mjs`, and replace the link here.

Posters are in `docs/social/posters/`:

| Poster | X (1600×900) | Instagram / Threads (1080×1350, 4:5) |
| :--- | :--- | :--- |
| Tripwire: the circuit breaker | `tripwire-x.png` | `tripwire-4x5.png` |
| Check before you sign | `check-x.png` | `check-4x5.png` |
| Retold: the wallet reader | `retold-x.png` | `retold-4x5.png` |

### One poster for both products, black and white

`docs/social/brand/`, made by `node docs/social/brand-poster.mjs` (it has its
own `SITE` line). Same design in every file; the background is the site's
hero shader. Pick black or white to suit the feed.

| Where | Size | Black | White |
| :--- | :--- | :--- | :--- |
| Instagram feed, Threads, Facebook, LinkedIn (the main one) | 1080×1350, 4:5 | `retold-dark-4x5.png` | `retold-light-4x5.png` |
| X / Twitter, LinkedIn link post, YouTube community | 1600×900, 16:9 | `retold-dark-16x9.png` | `retold-light-16x9.png` |
| Square fallback: Telegram, Discord, anywhere 4:5 crops | 1080×1080, 1:1 | `retold-dark-1x1.png` | `retold-light-1x1.png` |
| Stories, Reels, TikTok, Shorts | 1080×1920, 9:16 | `retold-dark-9x16.png` | `retold-light-9x16.png` |

The 9:16 keeps everything between 250px from the top and 300px from the
bottom, clear of the story UI. The "$292M → $0" row is the Kelp DAO replay:
say "in our replay" in the caption.

Every claim below comes from the README. Don't add "72 hours", "sub-5ms" or a
"$2.8B" figure. The $292M, $11.58M and ~$10M numbers are sourced in the
README. The "$0" result is from **our replay**, so always say so.

---

## X: main thread

Each post is under 280 characters. X counts a link as 23 characters.

**1/6**: attach `tripwire-x.png`

> $292M left Kelp DAO's bridge in a single release.
>
> Rate limits, pauses and security councils all act after a transaction
> lands. Against a one-transaction drain, that's too late.
>
> Tripwire scores each bridge payout before it executes. Live on Sepolia 🧵

**2/6**

> One question before a bridge pays out: is this payout backed by a burn we
> can verify?
>
> If not, the guardian contract tightens just that route:  
> 0.65 → THROTTLE, cap halved  
> 0.85 → DELAY, big payouts held 30 min  
> 0.95 → FREEZE, route paused

**3/6**

> We replayed Verus ($11.58M), Syscoin (~$10M) and Kelp DAO ($292M) through
> Tripwire.
>
> Acting before execution: $0 out in all three.  
> Acting one block later: the full amount, every time.
>
> That second line is the whole argument.

**4/6**: attach `check-x.png`

> The same contract checks protect people too.
>
> Check before you sign: paste a pending transaction and get green, yellow or
> red, with the reasons. An unlimited approval to a day-old, unverified
> contract comes back red.
>
> Nothing to connect, nothing to sign.

**5/6**: attach `retold-x.png`

> And the everyday part: paste any wallet and read its history in plain
> English. Draft Form 8949, an approval audit, 5 EVM chains. Read-only.
>
> https://chainstory-iota.vercel.app

**6/6**

> Honest limits: the Tripwire demo runs on Sepolia with demo contracts, not
> a production bridge. The tax report is a draft that reads the last 100
> transactions.
>
> Open source, MIT, 303 tests. Break it and tell me how:
> github.com/shokkanuly/Chainstory

### X: single post, if you don't want a thread

Attach `tripwire-x.png`.

> A circuit breaker for bridges.
>
> Tripwire scores each payout before it executes and pauses just the route
> under attack. In our replay of the $292M Kelp DAO drain, $0 left.
>
> Live on Sepolia, open source:
> https://chainstory-iota.vercel.app

---

## Instagram: one carousel post

Upload these three as **one carousel**, in this order: `tripwire-4x5.png`,
`check-4x5.png`, `retold-4x5.png`. Instagram's feed is 4:5, so the posters
fill the screen without cropping.

Links in Instagram captions can't be clicked. Put
`chainstory-iota.vercel.app` in your bio (Edit profile → Links) and say
"link in bio".

**Caption**

> $292M left Kelp DAO's bridge in a single release. Every defence we have
> today acts after the transaction lands.
>
> Tripwire acts before. It scores each bridge payout before it executes, and
> tightens just that route: throttle, delay, freeze. It's running live on the
> Sepolia testnet.
>
> Swipe → the same checks for people. Paste a pending transaction and get
> green, yellow or red, with the reasons. Or paste any wallet and read its
> history in plain English.
>
> Read-only. Nothing to connect, nothing to sign. Open source.
>
> Link in bio.
>
> #ethereum #web3 #defi #crypto #blockchainsecurity

**Alt text** (Advanced settings → Accessibility, one per slide)

1. Tripwire poster. A table of scores and guardian tiers from the Sepolia
   run: 0.00 none, 0.65 throttle, 0.85 delay, 1.00 freeze.
2. Check before you sign poster. A green card for a plain token transfer and
   a red card for an unlimited approval to a day-old, unverified contract.
3. Retold poster. A block explorer's raw swap data next to Retold's version:
   "Swapped 2.0 ETH for 3,400 USDC", marked illustrative.

**Story**: share the post to your story and add a **Link** sticker pointing
to https://chainstory-iota.vercel.app. Stories are the one place on
Instagram where a link can be clicked.

---

## Threads: three connected posts

Threads allows 500 characters per post and clickable links. Use the 4:5
posters: they fill the feed like they do on Instagram. Write in the first
person, a bit slower than on X.

**Post 1**: attach `tripwire-4x5.png`

> In April, $292M left Kelp DAO's bridge in one release. Not over hours. One
> transaction.
>
> Every defence we have (rate limits, pauses, security councils) acts after
> a transaction lands. Against a drain like that, it's already over.
>
> So I built Tripwire. Before a bridge pays out, it asks one question: is
> this payout backed by a burn we can verify? If not, a guardian contract
> tightens just that route: throttle, then delay, then freeze.

**Post 2**: reply to post 1, attach `check-4x5.png`

> We replayed three real bridge exploits through it. When it acts before
> execution, $0 leaves in all three replays. When it acts one block later,
> everything leaves. That's the whole point.
>
> The same checks work for people, too. Paste a pending transaction and you
> get green, yellow or red, with the reasons. No wallet to connect, nothing
> to sign.

**Post 3**: reply to post 2, attach `retold-4x5.png`

> It's all live, with the Tripwire demo running on the Sepolia testnet. It's
> open source, and if something reads wrong, I want to hear it.
>
> https://chainstory-iota.vercel.app

---

## Posting notes

- Post in this order: X thread, then Instagram, then Threads. Each one can
  mention the others ("full thread on X").
- On X, the link is in post 5. Reply to your own post 1 with the link about
  an hour later, so people who only read the top still find it.
- Put the same link in the X bio, the Instagram bio and the Threads bio.
  Threads uses your Instagram profile, so adding it on Instagram covers
  both.
- For the first two days, answer every reply. Early replies help the posts
  get seen on all three platforms.
