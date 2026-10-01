// src/components/motion/DecodeText.tsx
//
// Text that decodes from hex into English, left to right: the whole product in
// one gesture. Used on the landing headline, the sample translation, and every
// story in the platform's feed as it arrives.
//
// SAFETY, the same contract as AnimatedNumber: the real text is the resting
// state. Before the effect starts, and after it ends, this renders the plain
// string and nothing else. While it runs (under a second), the real characters
// stay in the DOM, laid out exactly where they will end up, and a hex glyph is
// painted over each unresolved one. So a line never re-wraps when it resolves,
// and if the animation is interrupted the text is still right there.
// Screen readers get the plain string throughout; the scrambled layer is
// hidden from them.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useReducedMotion } from 'framer-motion';
import { glyphAt, resolvedCount } from '@/lib/decode';

type Tag = 'span' | 'p' | 'h1' | 'h2' | 'h3';
type Phase = 'idle' | 'running' | 'done';

/** Past this length a sentence is a paragraph, and decoding it would be noise. */
const MAX_CHARS = 160;
/** How often an unresolved glyph changes, in ms. Faster reads as flicker. */
const GLYPH_MS = 55;

export default function DecodeText({
  text,
  as: Component = 'span',
  className,
  style,
  duration = 900,
  delay = 0,
  play,
}: {
  text: string;
  as?: Tag;
  className?: string;
  style?: CSSProperties;
  /** Total time to resolve, in ms. */
  duration?: number;
  delay?: number;
  /** Omit to start when scrolled into view. Pass a boolean to control it from the parent. */
  play?: boolean;
}) {
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLElement>(null);
  const visRef = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const disabled = reduce || text.length === 0 || text.length > MAX_CHARS;

  // A new text is decoded afresh.
  const lastText = useRef(text);
  useLayoutEffect(() => {
    if (lastText.current !== text) {
      lastText.current = text;
      setPhase('idle');
    }
  }, [text]);

  // Controlled: the parent says when.
  useLayoutEffect(() => {
    if (disabled || play === undefined) return;
    if (play && phase === 'idle') setPhase('running');
  }, [play, phase, disabled]);

  // Uncontrolled: start on entering the viewport. If already on screen at
  // mount, start before the first paint so the plain text never flashes.
  useLayoutEffect(() => {
    if (disabled || play !== undefined || phase !== 'idle') return;
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.92 && r.bottom > 0) {
      setPhase('running');
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          io.disconnect();
          setPhase('running');
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [disabled, play, phase, text]);

  // The run itself: written straight to the DOM, not through state, so a
  // decoding sentence does not re-render sixty times a second.
  useLayoutEffect(() => {
    if (phase !== 'running') return;
    const root = visRef.current;
    if (!root) return;
    const chars = Array.from(root.querySelectorAll<HTMLElement>('[data-i]'));
    const start = performance.now() + delay;
    let lastSwap = -Infinity;
    let raf = 0;
    let settle = 0;

    const step = (now: number) => {
      const progress = Math.max(0, (now - start) / duration);
      const resolved = resolvedCount(text.length, progress);
      const swap = now - lastSwap >= GLYPH_MS;
      if (swap) lastSwap = now;
      for (const el of chars) {
        const i = Number(el.dataset.i);
        if (i < resolved) {
          if (el.dataset.g !== undefined) {
            delete el.dataset.g;
            el.classList.add('dc-hit');
          }
        } else if (swap) {
          el.dataset.g = glyphAt(text, i, 0, Math.random);
        }
      }
      if (progress >= 1) {
        // Let the last characters' glow finish, then go back to plain text.
        settle = window.setTimeout(() => setPhase('done'), 450);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    step(performance.now());

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [phase, text, delay, duration]);

  // A controlled run that is switched off mid-way ends at the real text.
  useEffect(() => {
    if (play === false && phase === 'running') setPhase('done');
  }, [play, phase]);

  const Root = Component as 'span';
  if (phase !== 'running') {
    return (
      <Root ref={rootRef} className={className} style={style}>
        {text}
      </Root>
    );
  }

  let index = 0;
  const words = text.split(/(\s+)/);
  return (
    <Root ref={rootRef} className={className} style={style}>
      <span className="sr-only">{text}</span>
      <span ref={visRef} aria-hidden="true" className="dc">
        {words.map((w, k) => {
          if (/^\s+$/.test(w)) {
            index += w.length;
            return w;
          }
          const first = index;
          index += w.length;
          return (
            <span key={k} className="dc-w">
              {[...w].map((ch, j) => (
                <span key={j} className="dc-c" data-i={first + j}>
                  {ch}
                </span>
              ))}
            </span>
          );
        })}
      </span>
    </Root>
  );
}
