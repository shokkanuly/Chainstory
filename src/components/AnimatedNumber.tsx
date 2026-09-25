// src/components/AnimatedNumber.tsx
//
// Counts a figure up to its value the first time it comes into view.
//
// The reason is not decoration. A tax dashboard drops several large numbers on
// screen at once and they all compete; counting them up says "this was
// computed from your history" and gives the eye somewhere to land.
//
// SAFETY, and this is the whole design of the component: the correct value is
// rendered as the element's children and is never removed. The effect only
// overwrites the text WHILE an animation is running, and always restores the
// exact value when it finishes. If the animation never starts, never finishes,
// or throws, the real number is what stays on screen.
//
// An earlier version wrote a zero as its resting state and animated up from
// there. When the in-view trigger did not fire, every figure on the dashboard
// read $0.00 — a confident, plausible, wrong number, in a product whose entire
// purpose is not producing those. Hence: the value is the default, motion is
// the exception.

import { useEffect, useRef } from 'react';
import { animate, useInView, useReducedMotion } from 'framer-motion';
import { DURATION, EASE } from '../lib/motion';

export default function AnimatedNumber({
  value,
  format,
  className,
  style,
}: {
  value: number;
  /** Formats the in-flight number. Must match the static formatter exactly. */
  format: (n: number) => string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const reduce = useReducedMotion();
  const hasRun = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Reduced motion, zero values, or a repeat render: leave the rendered
    // value exactly as it is.
    if (reduce || !inView || value === 0 || hasRun.current) return;
    hasRun.current = true;

    const controls = animate(0, value, {
      duration: DURATION.slow,
      ease: EASE,
      // Written directly rather than through state, so counting does not
      // re-render the tree sixty times a second.
      onUpdate: (latest) => {
        el.textContent = format(latest);
      },
      onComplete: () => {
        // Restore the exact value, never a rounding artefact of the last frame.
        el.textContent = format(value);
      },
    });

    return () => {
      controls.stop();
      // Interrupted mid-count: put the true value back immediately.
      el.textContent = format(value);
    };
  }, [value, format, inView, reduce]);

  return (
    <span ref={ref} className={className} style={style}>
      {format(value)}
    </span>
  );
}
