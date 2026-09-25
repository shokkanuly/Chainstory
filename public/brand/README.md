# ChainStory logo

The mark is three slanted bars carrying a violet-to-blue gradient. The
wordmark sits to its right. **Nothing in this project draws its own
ChainStory mark** — in the app, import the component; anywhere else, use a
file from this folder.

## In the app

```tsx
import Logo from '@/components/Logo'

<Logo />                    // lockup, 28px box
<Logo size={20} />          // smaller
<Logo showWordmark={false} />  // mark alone, for tight spots
<Logo flat />               // single colour, for print or a stamp
```

The mark keeps its gradient. The wordmark is drawn as a CSS mask filled with
`currentColor`, so it takes the colour of the surrounding text and works on
light and dark surfaces without a second asset. It is `currentColor` rather
than a token on purpose: the `/v2` prototype has its own token space, where a
`--b-text` reference falls back to the light-mode ink and disappears against
that dark canvas.

## Files

| File | What it is | Use it for |
| :--- | :--- | :--- |
| `chainstory-mark.svg` | Vector mark, gradient baked in | Any size, any surface |
| `chainstory-wordmark.png` | Wordmark as an alpha mask | The `Logo` component |
| `chainstory-wordmark-ink.png` | Wordmark, dark ink, transparent | Light backgrounds |
| `chainstory-wordmark-white.png` | Wordmark, white, transparent | Dark backgrounds |
| `chainstory-lockup.png` | The original supplied artwork | Reference and hand-off |
| `chainstory-mark.png` | The original supplied mark | Reference and hand-off |
| `../favicon.svg` | The mark, padded to a square | Browser tab |

The mark's vector geometry was traced from `chainstory-mark.png` and matches
it to within antialiasing. If the two ever disagree, the PNG is the original.

## Proportions

Measured from the supplied lockup, and encoded in both `Logo.tsx` and
`docs/social/build.py`. Do not eyeball these when placing the logo:

- Mark aspect ratio `667 : 534`
- Gap between mark and wordmark: `0.532 x` mark height
- Wordmark top sits `0.101 x` mark height below the mark's top
- Wordmark height: `0.885 x` mark height, aspect ratio `705 : 123`

## Gradient

```
#6e6afa  0%   →   #8b5cf6  45%   →   #5598de  100%      (135°)
```

Applied per bar, so a short bar shows the same colour travel as a long one.
Outside the mark, treat this gradient as the identity: at most one other
use per screen, per the rule in `src/styles/brand.css`.
