// src/components/motion/RevealText.tsx
//
// A heading whose words rise out of their own baseline, one after another,
// when it scrolls into view. Each word is clipped by a mask the height of its
// line, so the type appears to be set in place rather than faded on.
//
// Communicates sequence: the eye is walked through the sentence in reading
// order. Plays once. Under reduced motion it is simply the heading.

import type { CSSProperties } from 'react';
import { motion, type Variants } from 'framer-motion';
import { EASE, useReducedMotion } from '@/lib/motion';

export interface RevealPart {
  text: string;
  color?: string;
  className?: string;
}

const TAGS = { h1: motion.h1, h2: motion.h2, h3: motion.h3, p: motion.p } as const;

export default function RevealText({
  parts,
  as = 'h2',
  className,
  style,
  delay = 0,
  stagger = 0.055,
}: {
  parts: RevealPart[];
  as?: keyof typeof TAGS;
  className?: string;
  style?: CSSProperties;
  delay?: number;
  stagger?: number;
}) {
  const reduce = useReducedMotion();
  const M = TAGS[as];

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : stagger, delayChildren: reduce ? 0 : delay } },
  };
  const word: Variants = {
    hidden: { y: '115%', rotate: 5, opacity: 0.001 },
    show: { y: '0%', rotate: 0, opacity: 1, transition: { duration: 0.85, ease: EASE } },
  };

  return (
    <M
      className={className}
      style={style}
      variants={container}
      initial={reduce ? false : 'hidden'}
      whileInView="show"
      viewport={{ once: true, amount: 0.35 }}
    >
      {parts.map((part, pi) => {
        const words = part.text.split(' ').filter(Boolean);
        return (
          <span key={pi} className={part.className} style={part.color ? { color: part.color } : undefined}>
            {words.map((w, wi) => (
              <span key={wi}>
                <span className="rv-w">
                  <motion.span className="rv-i" variants={word}>
                    {w}
                  </motion.span>
                </span>
                {wi < words.length - 1 || pi < parts.length - 1 ? ' ' : null}
              </span>
            ))}
          </span>
        );
      })}
    </M>
  );
}
