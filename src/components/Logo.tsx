// src/components/Logo.tsx
//
// The ChainStory mark: three staggered bars, offset right, full, then left.
// They read as stacked blocks and as lines of a story at the same time, which
// is the whole idea of the product.
//
// Geometry and gradient are traced from the supplied artwork in
// public/brand/, not approximated by eye — the bars have three different
// slopes, which is the kind of detail a redraw loses. The bars are drawn as
// vector so they stay crisp at any size and cost no request; the wordmark is
// the artwork itself, used as a mask, so its letterforms are exact rather
// than a bet on which typeface the original used.
//
// Nothing else in the app draws a ChainStory mark. Import this instead.

const MARK_GRADIENT_ID = 'chainstory-mark-gradient';

/**
 * Bar geometry, traced from public/brand/chainstory-mark.png. Authored in the
 * artwork's own 667x534 space and mapped into a 100x100 box below, so the
 * numbers can be checked against the source directly.
 */
const BARS = [
  '300,66.8 667,0 667,127.3 300,194.1',   // top, offset right
  '0,236.8 667,170.1 667,297.4 0,364.1',  // middle, full width
  '0,406.9 500,340.2 500,467.5 0,534.2',  // bottom, offset left
];

// The artwork is 667x534. Fitted to 78 units wide and centred in the box, to
// match the optical weight the rest of the UI was spaced against.
const MARK_W = 78;
const MARK_SCALE = MARK_W / 667;
const MARK_H = 534 * MARK_SCALE;
const MARK_X = (100 - MARK_W) / 2;
const MARK_Y = (100 - MARK_H) / 2;

// Wordmark proportions, measured from the supplied lockup.
const WORD_H_PER_MARK_H = 123 / 139;
const WORD_ASPECT = 705 / 123;

export function LogoMark({
  size = 28,
  flat = false,
  className,
}: {
  size?: number;
  /** Single-colour variant for stamps, print, or anywhere a gradient will not render. */
  flat?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
      focusable="false"
    >
      {!flat && (
        <defs>
          {/* Per bar, so a short bar shows the same colour travel as a long one. */}
          <linearGradient id={MARK_GRADIENT_ID} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6E6AFA" />
            <stop offset="45%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#5598DE" />
          </linearGradient>
        </defs>
      )}
      <g transform={`translate(${MARK_X} ${MARK_Y}) scale(${MARK_SCALE})`}>
        {BARS.map((points) => (
          <polygon
            key={points}
            points={points}
            fill={flat ? 'currentColor' : `url(#${MARK_GRADIENT_ID})`}
          />
        ))}
      </g>
    </svg>
  );
}

/**
 * Mark plus wordmark.
 *
 * The wordmark is the supplied artwork painted through a CSS mask rather than
 * live text, because the two must not drift: set as text it would silently
 * change with the font stack. It is filled with a colour token, so one asset
 * serves the light marketing surface and the dark app, and the accessible
 * name is carried by the sr-only text beside it.
 */
export default function Logo({
  size = 28,
  flat = false,
  showWordmark = true,
  className,
}: {
  size?: number;
  flat?: boolean;
  showWordmark?: boolean;
  className?: string;
}) {
  const wordHeight = size * (MARK_H / 100) * WORD_H_PER_MARK_H;

  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <LogoMark size={size} flat={flat} />
      {showWordmark && (
        <span
          aria-hidden
          style={{
            width: wordHeight * WORD_ASPECT,
            height: wordHeight,
            // currentColor, not a token: the /v2 prototype defines its own
            // token space, where --b-text falls back to the light-mode ink and
            // renders the wordmark near-invisible on its dark canvas.
            // Inheriting the surrounding text colour is correct on every
            // surface, which is the point of masking rather than shipping a
            // coloured image.
            backgroundColor: 'currentColor',
            WebkitMaskImage: 'url(/brand/chainstory-wordmark.png)',
            maskImage: 'url(/brand/chainstory-wordmark.png)',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
          }}
        />
      )}
      <span className="sr-only">ChainStory</span>
    </span>
  );
}
