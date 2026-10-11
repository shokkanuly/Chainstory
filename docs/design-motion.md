# Motion and readability

The Tripwire site (`/`), replay (`/tripwire`) and operations viewer
(`/tripwire/operations`) share one motion layer:
`src/components/motion/`, `src/lib/decode.ts` and `src/styles/motion.css`. This page is the
contract for it: what moves, why, and what must stay true when it does.

## Rules

1. **Light at the top, canvas below.** The live silk field (`ShaderField`, a WebGL fragment shader)
   sits behind the landing hero and behind a header band on each platform page (`PageAurora`), and
   dissolves into plain canvas. Body text never sits on moving light. The one gradient below the
   hero is the still horizon behind the closing call to action.
2. **The resting state is the truth.** `DecodeText` renders the plain string before and after it
   runs; while it runs, the real characters stay in the DOM in their final layout and a hex glyph is
   painted over each one. `AnimatedNumber` follows the same contract. If an animation never starts or
   is interrupted, the correct text is on screen.
3. **Motion says something.** Decode (hex resolving into readable evidence) introduces the Tripwire headline
   and illustrative payment status. Example checks scan in sequence; a status icon lands
   after a scenario is selected. These are presentation effects, not execution evidence. The stamp marks a
   verdict landing. Spotlight, tilt and magnetic buttons are feedback on the pointer.
4. **Reduced motion is honoured everywhere.** Every component checks `useReducedMotion`; the
   shader draws one still frame; `brand.css` stops any stray CSS animation.
5. **Cost.** The shader renders at about half device resolution and stops when off screen or when
   the tab is hidden. No WebGL, or a lost context, leaves a static CSS gradient. Effects are
   transform, opacity and paint; none animates layout except the timeline's filter reflow.

## Pieces

| Piece | Where | What it does |
| :--- | :--- | :--- |
| `ShaderField` | landing hero, `PageAurora` | Silk ribbons of light; bends toward the pointer; colours from `--fx-*` tokens per theme |
| `DecodeText` | Tripwire hero, payment status, replay/page titles | Text resolves from hex, left to right |
| `RevealText` | Tripwire landing section headings | Words rise out of their own line, in reading order |
| `TiltCard`, `Magnetic`, `SpotlightTracker` | hero payment card, CTAs, every `.b-card` / `.fx-spot` | Pointer feedback |
| `VelocityMarquee` | landing ticker | Speeds and leans with scroll velocity |

## Type

Geist for reading, Geist Mono for figures, hashes and labels, Space Grotesk only for display
headlines. Small uppercase labels are at least 12px with modest tracking. The section accents
(`--b-purple`, `--b-cyan`, `--b-amber`, `--b-red`) are tuned per theme so text in them clears
4.5:1: the reference's bright set on dark, a deeper set on white.

## Tripwire landing adaptation — 11 October 2026

The existing silk field, hex decode, word reveals, velocity ticker, magnetic
actions, tilt and spotlight now accompany Tripwire content. Desktop hero copy
and payment card move at different scroll speeds; parallax and tilt angles are
zero below 851 px or without a fine hover pointer. The mobile field is dimmer
with a stronger canvas veil behind reading text. Section reveals play once.

The payment example stays under explicit visitor control: selecting a scenario
restarts its check sweep and decodes the resulting status. There is no timer
changing an announced payment state. Screen readers receive plain headings,
one static ticker description and the selected payment status. Reduced motion
uses plain text, visible sections, a still shader frame, a wrapped ticker with
one visual copy and no scanning, parallax, magnetic movement or card tilt.
