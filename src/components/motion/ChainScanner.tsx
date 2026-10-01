// src/components/motion/ChainScanner.tsx
//
// The loading state for a wallet fetch: a conveyor of blocks passing under a
// scanning beam. It replaces a blinking grey skeleton, and says what is
// happening (history is being read off a chain) rather than only that
// something is.
//
// The hex inside the blocks is decoration, generated once, and hidden from
// assistive tech. The only text that claims anything is the status line,
// which the caller supplies from real app state.

import { useMemo } from 'react';
import { HEX_GLYPHS } from '@/lib/decode';

function hexLine(seed: number, length: number): string {
  let out = '';
  let x = seed * 9301 + 49297;
  for (let i = 0; i < length; i++) {
    x = (x * 9301 + 49297) % 233280;
    out += HEX_GLYPHS[Math.floor((x / 233280) * 16)];
  }
  return out;
}

export default function ChainScanner({ status }: { status: string }) {
  const blocks = useMemo(() => Array.from({ length: 9 }, (_, i) => [hexLine(i + 1, 10), hexLine(i + 40, 10), hexLine(i + 90, 6)]), []);
  return (
    <div className="b-card overflow-hidden p-5 sm:p-6" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2.5 text-[15px] font-medium">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: 'var(--b-purple)' }} />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: 'var(--b-purple)' }} />
          </span>
          {status}
        </p>
        <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted-foreground">Read-only · no signature</span>
      </div>
      <div className="fx-chain mt-5 py-1" aria-hidden>
        <div className="fx-chain-track pl-4">
          {[...blocks, ...blocks].map((lines, i) => (
            <div key={i} className="fx-block">
              {lines.map((l, k) => (
                <span key={k} className="block truncate" style={k === 0 ? { color: 'var(--b-text)' } : undefined}>
                  {k === 0 ? `0x${l}` : l}
                </span>
              ))}
            </div>
          ))}
        </div>
        <div className="fx-beam" />
      </div>
      <div className="mt-6 grid gap-3" aria-hidden>
        <div className="fx-skel h-24 rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="fx-skel h-20 rounded-xl" style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
