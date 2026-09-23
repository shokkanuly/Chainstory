# v2 design direction

Prototype route: `/v2`. The current UI stays on `/` untouched, so the two can be
compared side by side before anything is migrated.

## Design read

Redesign, overhaul mode: a consumer web3 wallet-analytics app for crypto-native
users, in the visual family of Phantom, Backpack and Jupiter. App-first, not
marketing-first.

Dials: variance 5, motion 5, density 6. This is product UI, not a landing page,
so restraint beats expression. Figures need to be scannable and calm.

## Audit of the current UI

What is being retired, and why:

| Pattern | Problem |
| :--- | :--- |
| Blue-to-purple gradient text (`text-gradient-chain`) | The single most recognisable AI-generated design signature |
| Neon glow utilities (`glow-chain`, `glow-chain-strong`) | Outer glows read as 2019 crypto, not as craft |
| Emoji as iconography (`💱 💎 ↔️ 🖼️ ⛽ 🔑 🛡️`) | Renders differently per platform, no weight or size control, reads amateur |
| Blue-grey `#0b0f19` canvas with `#3b82f6` accent | Bootstrap-dark. Zero brand identity |
| App buried mid-page under a marketing landing | The thing people came for is four scrolls down |
| Proportional numerals on financial figures | Digits jitter and columns do not align |

What is preserved: the information architecture, the plain-English story copy
(that copy is the product), the honesty work on demo-data labelling, and the
category taxonomy of trade / income / transfer / NFT / approval.

## The system

**Palette.** One accent, periwinkle `#9d8cff`, used only on interactive
elements and the brand mark, roughly 5% of pixels. Everything else is neutral on
a near-black `#0a0a0c` canvas. Four surface steps, depth from hairline borders
rather than shadow.

The accent is deliberately not green or red, because those are reserved:
`#3fcf8e` means gain, `#f5646e` means loss, `#f5a524` means warning. In a tax
and risk product a brand colour that collides with financial semantics is a
liability. Purple is justified here by the brief (Solana and Phantom sit in that
family) and is executed flat, with no gradients and no glows.

**Type.** Geist for text, Geist Mono for every number, address and hash, with
tabular figures so columns align and digits do not shift as values update.
Self-hosted via Fontsource, subset per script, no external font request.

**Shape.** Cards 16px, controls 10px, pills full-radius. No other values.

**Icons.** Phosphor only, one family, weight switching between `regular` and
`fill` to signal selection. No emoji, no hand-drawn SVG paths.

**Motion.** Two animations exist, and each one communicates something: the tab
indicator is a shared-layout element so you can see which view you moved to and
from, and the activity feed staggers on entry to express ordering. Both collapse
under `prefers-reduced-motion`. Nothing loops.

**Identity marks.** Wallet avatars are a deterministic gradient derived from the
address bytes, so the same wallet always renders the same mark. Chain marks come
from the DefiLlama icon CDN, which the app already depends on for pricing.

## Layout

A left rail holds navigation and the watchlist. A sticky top bar holds search,
the chain switcher and the primary action. The workspace is the page: wallet
identity and portfolio figures, then the demo-data notice, then a segmented
control over four views.

Each view deliberately uses a different layout family rather than repeating one
card grid: activity is a date-grouped feed, taxes is a bare figure grid with no
nested card chrome, approvals is an exposure table, risk is an annotated list.

Every row was rebuilt to hold its shape at 375px. The activity row is two lines
that each balance content against a right-aligned figure, so the value column
never competes with the story for horizontal room.

## States

Loading is a skeleton matching the final row shape, not a spinner. The empty
state explains what to paste and offers a sample. The demo notice is carried
over from the live app and says plainly that every figure on screen is
synthetic.

## Open questions before migration

1. Does the marketing landing page survive, or does the app become the root and
   marketing move to a separate page?
2. Should the accent stay periwinkle, or move toward a chain-neutral identity
   that does not read as Solana on an EVM product?
3. The rail currently duplicates the tab bar. On a wider product it would hold
   distinct destinations such as watchlist, settings and multi-wallet.
