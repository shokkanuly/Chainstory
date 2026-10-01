// src/components/motion/VelocityMarquee.tsx
//
// A ticker that is tied to your scroll: it idles along on its own, speeds up
// and leans into the direction you scroll, and settles back when you stop.
// The page feels like one mechanism rather than a stack of sections.
//
// Under reduced motion it is a still row.

import { useRef, type ReactNode } from 'react';
import { motion, useAnimationFrame, useMotionValue, useScroll, useSpring, useTransform, useVelocity } from 'framer-motion';
import { useReducedMotion } from '@/lib/motion';

const wrap = (min: number, max: number, v: number) => {
  const range = max - min;
  return ((((v - min) % range) + range) % range) + min;
};

export default function VelocityMarquee({ children, baseSpeed = 2.2 }: { children: ReactNode; baseSpeed?: number }) {
  const reduce = useReducedMotion();
  const offset = useMotionValue(0);
  const { scrollY } = useScroll();
  const velocity = useSpring(useVelocity(scrollY), { damping: 50, stiffness: 400 });
  const boost = useTransform(velocity, [0, 1200], [0, 6], { clamp: false });
  const skew = useTransform(velocity, [-2400, 0, 2400], [7, 0, -7]);
  const direction = useRef(1);
  // The row is rendered four times; one quarter is one full cycle.
  const x = useTransform(offset, (v) => `${wrap(-25, 0, v)}%`);

  useAnimationFrame((_, delta) => {
    if (reduce) return;
    const b = boost.get();
    if (b < -0.05) direction.current = -1;
    else if (b > 0.05) direction.current = 1;
    const step = direction.current * baseSpeed * (delta / 1000) * (1 + Math.abs(b));
    offset.set(offset.get() - step);
  });

  return (
    <div className="overflow-hidden" aria-hidden>
      <motion.div className="flex w-max" style={reduce ? undefined : { x, skewX: skew }}>
        {[0, 1, 2, 3].map((k) => (
          <span key={k} className="flex shrink-0">
            {children}
          </span>
        ))}
      </motion.div>
    </div>
  );
}
