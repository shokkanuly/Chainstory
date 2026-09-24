// src/components/Logo.tsx
//
// The ChainStory mark: three staggered bars, offset right, full, then left.
// They read as stacked blocks and as lines of a story at the same time, which
// is the whole idea of the product.
//
// Drawn as inline SVG rather than an image file so it stays crisp at every
// size, inherits colour in its flat variant, and costs no network request in
// the navbar. This is the one place a hand-authored SVG is right: it is the
// brand mark, not decoration.

const MARK_GRADIENT_ID = 'chainstory-mark-gradient';

/** Bar geometry, measured off the design board. Same slope, staggered widths. */
const BARS = [
  '45.5,24.5 89,20.2 89,35.2 45.5,39.5', // top, offset right
  '11,44.8 89,36.0 89,51.0 11,59.8',     // middle, full width
  '11,65.0 69.5,59.2 69.5,74.2 11,80.0', // bottom, offset left
];

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
          <linearGradient id={MARK_GRADIENT_ID} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="65%" stopColor="#4C7CFF" />
            <stop offset="100%" stopColor="#35B8DD" />
          </linearGradient>
        </defs>
      )}
      {BARS.map((points) => (
        <polygon
          key={points}
          points={points}
          fill={flat ? 'currentColor' : `url(#${MARK_GRADIENT_ID})`}
        />
      ))}
    </svg>
  );
}

/**
 * Mark plus wordmark. The wordmark is live text rather than outlines, so it
 * stays selectable, searchable and readable to assistive technology.
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
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <LogoMark size={size} flat={flat} />
      {showWordmark && (
        <span
          className="font-semibold tracking-[-0.03em]"
          style={{ fontSize: size * 0.68, color: 'var(--b-text)' }}
        >
          ChainStory
        </span>
      )}
      <span className="sr-only">ChainStory</span>
    </span>
  );
}
