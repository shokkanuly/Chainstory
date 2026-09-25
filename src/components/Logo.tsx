// src/components/Logo.tsx — the Tripwire mark (three staggered bars) and wordmark.
//
// Bar geometry and gradient are traced from public/brand/tripwire-mark.svg.
// Nothing else in the app draws the mark; import this.

const MARK_GRADIENT_ID = 'tripwire-mark-gradient';

/**
 * Bar geometry, authored in the artwork's own 667x534 space and mapped into a 100x100 box below, so the
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

/** Mark plus the Tripwire wordmark, as live text so it inherits colour and stays selectable. */
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
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <LogoMark size={size} flat={flat} />
      {showWordmark ? (
        <span className="font-bold tracking-[-0.03em]" style={{ fontSize: size * 0.62 }}>
          Tripwire
        </span>
      ) : (
        <span className="sr-only">Tripwire</span>
      )}
    </span>
  );
}
