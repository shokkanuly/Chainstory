// src/components/ui/Logo.tsx — the one place the ChainStory logo is drawn.
//
// Two rules, so the mark cannot drift:
//   1. Nothing else in the app draws a ChainStory mark. Import this instead.
//   2. The mark is vector and keeps its own gradient. The wordmark is the
//      supplied artwork used as a CSS mask and filled with `currentColor`,
//      so it inherits the surrounding text colour and stays pixel-exact
//      rather than depending on a guess at the original typeface.

type LogoProps = {
  /** Height of the mark in pixels. The wordmark scales from it. */
  height?: number
  /** Mark only, for tight spots like a mobile bar or an avatar slot. */
  markOnly?: boolean
  className?: string
}

// Measured from the supplied artwork.
const MARK_RATIO = 667 / 534
const GAP_RATIO = 74 / 139
const WORD_TOP_RATIO = 14 / 139
const WORD_H_RATIO = 123 / 139
const WORD_ASPECT = 705 / 123

export default function Logo({ height = 28, markOnly = false, className = '' }: LogoProps) {
  const wordH = height * WORD_H_RATIO

  return (
    <span
      className={`inline-flex items-start ${className}`}
      style={{ gap: markOnly ? 0 : height * GAP_RATIO }}
      role="img"
      aria-label="ChainStory"
    >
      <svg
        width={height * MARK_RATIO}
        height={height}
        viewBox="0 0 667 534"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="cs-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6e6afa" />
            <stop offset="0.45" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#5598de" />
          </linearGradient>
        </defs>
        <g fill="url(#cs-mark)">
          <polygon points="300,66.8 667,0 667,127.3 300,194.1" />
          <polygon points="0,236.8 667,170.1 667,297.4 0,364.1" />
          <polygon points="0,406.9 500,340.2 500,467.5 0,534.2" />
        </g>
      </svg>

      {!markOnly && (
        <span
          aria-hidden="true"
          style={{
            width: wordH * WORD_ASPECT,
            height: wordH,
            marginTop: height * WORD_TOP_RATIO,
            backgroundColor: 'currentColor',
            WebkitMaskImage: 'url(/brand/chainstory-wordmark.png)',
            maskImage: 'url(/brand/chainstory-wordmark.png)',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
          }}
        />
      )}
    </span>
  )
}
