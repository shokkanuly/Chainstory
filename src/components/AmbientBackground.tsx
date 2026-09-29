// src/components/AmbientBackground.tsx
//
// The site's backdrop: soft ribbons of violet, pink and blue light, like silk
// in the dark. Drawn in SVG rather than shipped as an image, so it costs a few
// hundred bytes, stays sharp at any size, and changes colour with the theme
// (the --amb-* tokens in styles/ambient.css).
//
// Decorative only: fixed behind everything, never takes a click, hidden from
// assistive tech. The slow drift stops under prefers-reduced-motion
// (brand.css).

export default function AmbientBackground() {
  return (
    <div className="amb" aria-hidden="true">
      <svg className="amb-svg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id="amb-a" x1="0" y1="0" x2="1" y2="0.4">
            <stop offset="0" style={{ stopColor: 'var(--amb-blue)' }} />
            <stop offset="0.55" style={{ stopColor: 'var(--amb-violet)' }} />
            <stop offset="1" style={{ stopColor: 'var(--amb-pink)' }} />
          </linearGradient>
          <linearGradient id="amb-b" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: 'var(--amb-peach)' }} />
            <stop offset="0.45" style={{ stopColor: 'var(--amb-pink)' }} />
            <stop offset="1" style={{ stopColor: 'var(--amb-violet)' }} />
          </linearGradient>
          <linearGradient id="amb-c" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--amb-violet)' }} />
            <stop offset="1" style={{ stopColor: 'var(--amb-blue)' }} />
          </linearGradient>
          <filter id="amb-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="38" />
          </filter>
          <filter id="amb-soft" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        <g className="amb-drift">
          {/* The glow: wide ribbons, heavily blurred. */}
          <g filter="url(#amb-glow)" className="amb-glow">
            <path d="M-120 210 C 220 60, 520 380, 860 250 S 1380 40, 1580 170 L 1580 330 C 1320 240, 1080 470, 780 430 S 180 260, -120 420 Z" fill="url(#amb-a)" />
            <path d="M-80 760 C 260 520, 560 640, 880 560 S 1300 360, 1540 460 L 1540 600 C 1260 560, 1020 760, 720 780 S 160 700, -80 900 Z" fill="url(#amb-b)" />
          </g>
          {/* The silk: narrower bands with a soft edge, where the light catches. */}
          <g filter="url(#amb-soft)" className="amb-silk">
            <path d="M-100 300 C 240 150, 560 430, 900 300 S 1360 110, 1560 230 L 1560 262 C 1350 160, 1120 390, 890 350 S 260 230, -100 350 Z" fill="url(#amb-a)" />
            <path d="M-60 690 C 300 520, 600 640, 900 590 S 1320 430, 1520 510 L 1520 540 C 1300 470, 1060 650, 880 640 S 280 590, -60 740 Z" fill="url(#amb-b)" />
            <path d="M420 -40 C 560 160, 640 360, 980 520 S 1340 760, 1480 940 L 1440 960 C 1300 800, 1100 640, 940 560 S 520 220, 380 -40 Z" fill="url(#amb-c)" />
          </g>
        </g>
      </svg>
      {/* Keeps text readable: the canvas colour, thin at the top, thicker below. */}
      <div className="amb-veil" />
    </div>
  );
}
