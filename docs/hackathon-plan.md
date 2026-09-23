# Crypto World's Fair — submission plan

Researched 23 September 2026. Verify anything time-sensitive on
[colosseum.com/worldsfair](https://colosseum.com/worldsfair) before acting, since
press coverage and the official site disagreed on the track list.

## The clock

| | |
| :--- | :--- |
| Competition window | 14 September to 12 October 2026 |
| Hard deadline | 13 October 2026, 06:59 UTC (12 October, 11:59pm PT) |
| Today | 23 September 2026 |
| **Remaining** | **19 days** |

## The headline: you are eligible

Crypto World's Fair is not a Solana-only event. It is cross-ecosystem, and every
team competes for the general prizes regardless of chain. ChainStory already
indexes Ethereum, Arbitrum and Base, all three of which have their own tracks.
No rewrite is needed to enter.

This also answers the ZK Compression question: you do not need Solana for this
hackathon. Building a Solana product from scratch in 19 days would throw away
the two months of work you already have.

## Prizes

| Award | Amount |
| :--- | :--- |
| Grand prize | $30,000 |
| Next 20 projects | $15,000 each |
| Public Good prize | $5,000 |
| University prize | $5,000 |
| Solana ecosystem track | $100,000 pool, 10 projects at $10,000 |
| Total prize pool | $840,000 |
| Accelerator | $250,000 pre-seed per accepted team, 12 weeks in San Francisco |

Ecosystem tracks listed on the official site: Solana, Ethereum, Hyperliquid,
Base, Tempo, Arbitrum, Zcash, Robinhood Chain. Some press coverage listed Sui
and Bitcoin instead of Hyperliquid and Robinhood Chain, so confirm the current
list yourself before choosing.

## How you are actually scored

Colosseum publishes seven criteria. They are not weighted equally in practice;
this is a venture fund running a deal-sourcing funnel, not a code competition.

1. **Founder + market fit** — do you have the skills and a real reason to care
2. **Insight** — a non-obvious understanding of the problem
3. **Product + execution** — does it work, do you respond to feedback
4. **Potential market size**
5. **Founder communication** — can you explain it clearly
6. **Viability** — can this be a real business
7. **Traction** — existing demand, users, revenue

Top submissions go to a shortlist, then finalists get a 15-minute Zoom
interview. Note what is missing from that list: nobody scores your test
coverage. The engineering work matters because it makes the demo real, not
because it earns points directly.

### Where you stand

**Strong: insight.** "Every blockchain usability, tax and risk problem shares
one root cause, which is that on-chain data is unreadable, so solve the
translation layer once and it powers all three" is a genuine, defensible thesis.
Lead with it.

**Strong: product and execution.** As of today the app builds clean, lints
clean, passes 33 tests, and the tax engine is correct for the cases it covers.
That is above the median hackathon submission.

**Weak: traction.** You have zero users. This is the gap that most limits you,
and 19 days is enough to close some of it.

**Weak: market size and differentiation.** This is the honest risk, stated
plainly: crypto tax and wallet analytics is a crowded category with funded
incumbents. Koinly and CoinTracker own tax. Arkham, Nansen and Zerion own wallet
intelligence. A judge who knows the space will ask why you win. "Plain English"
alone is not an answer; the combination of reading, tax and risk from one
pipeline is closer to one, but you need to say who specifically is underserved
today and why the incumbents cannot serve them.

## The disclosure rule, and why it works in your favour

Pre-existing code is allowed, but you must disclose prior development, and
**products are judged on work completed between 14 September and 12 October**.

Your repo history splits cleanly:

- 13 July to 30 July 2026, before the window: initial build, landing page, ML
  pipeline scaffolding, first tax engine, first UI
- 23 September 2026, inside the window: the FIFO correctness fixes, real
  contract-risk lookups replacing fabricated data, approval calldata decoding,
  the test suite and CI, and the v2 design system

Do not hide the July work. Disclose it, then frame the September work as what it
is: you found that your own tax engine silently dropped every ETH-for-token
swap and reported zero cost basis, and that your risk scanner was inventing
contract ages from a string hash, and you fixed both and wrote regression tests
so they cannot come back. That is a better story than "we built it in four
weeks," because it demonstrates two things judges are explicitly looking for,
which are insight into the problem space and responsiveness to feedback.

## Problem: your existing submission docs misrepresent the product

`docs/submission_pack/` was written on 30 July, before the audit. It needs a
rewrite before submission, because parts of it describe a product that did not
work as claimed:

- Tax figures were wrong for the most common swap shape until today
- Contract risk analysis was fabricated from a hash of the address
- The ONNX model is still not shipped, so classification is rule-based
- The heavy emoji formatting reads as unserious to a venture audience

Rewrite it against the current README, which is now accurate. Claiming a
capability a judge can disprove in the 15-minute interview is the fastest way to
lose.

## 19-day plan

### Days 1 to 3, by 26 September: close the credibility gap

- [ ] Post a builder update today. Weekly one-minute videos are strongly
      recommended and you have missed the first week. The first one can be the
      audit story: here is a bug I found in my own tax engine and here is the
      fix.
- [ ] Rewrite `docs/submission_pack/` against the real feature set. Drop the
      emoji, drop the scorecard framing, state limits plainly.
- [ ] Get an Etherscan API key into a deployed build so the demo reads real
      chain data. Right now, with no key, the app shows synthetic data, and a
      judge who pastes their own wallet needs to see their real history.
- [ ] Decide the track. You support Ethereum, Base and Arbitrum. Pick where you
      are most credible, and check on the site whether multiple tracks are
      allowed per submission.

### Days 4 to 10, by 3 October: get traction

This is the weakest axis and the highest-leverage week.

- [ ] Deploy to a real domain with a backend key proxy, since `VITE_*` keys are
      public in the bundle and you cannot ship a production key in client code.
- [ ] Paginate past the 100-transaction window. It is the largest remaining
      source of tax inaccuracy and the easiest thing for a judge to catch.
- [ ] Get 20 to 50 real people to paste a wallet. Crypto Twitter, Farcaster,
      relevant subreddits, Colosseum Discord. Instrument it so you can report
      actual numbers.
- [ ] Collect three written quotes from real users. One sentence each beats a
      paragraph of your own copy.

### Days 11 to 16, by 9 October: the pitch

- [ ] Record the 2 to 3 minute presentation video. Structure: the problem in 20
      seconds, your insight in 20 seconds, the product working in 60 seconds,
      traction and market in 30 seconds, who you are in 20 seconds.
- [ ] Record the demo video, 3 minutes maximum. Screen recording, real wallet,
      real data, no slides. Show the plain-English feed, then the tax report,
      then the risk screen, because that sequence proves the one-pipeline thesis
      better than describing it.
- [ ] Write the go-to-market section: who the first 1,000 users are, where you
      reach them, why they pay.
- [ ] Have someone who does not know the project watch both videos and tell you
      what they think it does.

### Days 17 to 19, by 12 October: submit early

- [ ] Submit by 10 October, not the 12th. Deadline traffic breaks things.
- [ ] Repo public, or private with access granted to hackathon@colosseum.com
- [ ] Logo, team info with real backgrounds, location, chains and tools listed
- [ ] Prior development disclosed honestly
- [ ] Prepare for the 15-minute interview: know your numbers, know your
      competitors by name, and have a straight answer to "why does this win
      against Koinly."

## Two decisions that are yours

**Solo or team.** Your Arena profile currently says you are not looking for a
cofounder. Founder and market fit is a judging criterion, and an accelerator
investing $250,000 is underwriting a team. Solo founders do win, but if there is
someone credible you would genuinely want to build with, the next 19 days are
the moment. Changing that answer costs nothing and the field is active now.

**Scope.** You cannot do the full 19-day plan and also migrate the v2 design
across the whole app. Pick one. My read is that traction and an accurate,
deployed demo beat a prettier marketing page, so ship v2 on the workspace only
and leave the landing page alone.

## Sources

- [Crypto World's Fair hackathon page](https://colosseum.com/worldsfair)
- [Colosseum hackathon overview, judging and submission requirements](https://colosseum.com/hackathon)
- [Cryptobriefing coverage of the launch](https://cryptobriefing.com/colosseum-crypto-worlds-fair-hackathon/)
- [Prior Colosseum official rules, Breakout 2025](https://www.colosseum.com/files/Breakout%20Hackathon%20Official%20Rules%202025.pdf)
