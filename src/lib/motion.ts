// src/lib/motion.ts
//
// Shared motion vocabulary.
//
// Two problems this solves. Nine components animated with their own ad-hoc
// durations and easings, so nothing felt like one system. And only one of them
// checked prefers-reduced-motion, which means anyone who has asked their
// operating system to stop moving things still got every animation. For people
// with vestibular disorders that is not a preference, it is a symptom trigger.
//
// Every helper here collapses to a static state under reduced motion, so
// honouring it is the default rather than something each component remembers.
//
// The rule for adding anything new: motion must communicate something. Valid
// reasons are hierarchy, sequence, feedback, and state change. "It looked nice"
// is not one, and is how a product ends up feeling restless.

import { useReducedMotion, type Transition, type Variants } from 'framer-motion';

/** One easing for the whole product. Decelerating, so things arrive calmly. */
export const EASE = [0.16, 1, 0.3, 1] as const;

export const DURATION = {
  fast: 0.18,
  base: 0.36,
  slow: 0.55,
} as const;

export const spring: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 32,
  mass: 0.8,
};

/**
 * Entry animation for a block of content.
 *
 * Communicates hierarchy: things arrive in reading order, so the eye is led
 * rather than presented with everything at once.
 */
export function useRise(delay = 0, distance = 16) {
  const reduce = useReducedMotion();
  return {
    initial: reduce ? false : { opacity: 0, y: distance },
    animate: { opacity: 1, y: 0 },
    transition: { duration: DURATION.base, delay: reduce ? 0 : delay, ease: EASE },
  } as const;
}

/**
 * The same, triggered when the element scrolls into view.
 * `once` matters: re-animating on every scroll past is distracting and makes a
 * page feel unstable.
 */
export function useRiseInView(delay = 0, distance = 20) {
  const reduce = useReducedMotion();
  return {
    initial: reduce ? false : { opacity: 0, y: distance },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.25 },
    transition: { duration: DURATION.base, delay: reduce ? 0 : delay, ease: EASE },
  } as const;
}

/**
 * Parent/child stagger for lists.
 *
 * Communicates sequence, which is exactly what a transaction feed is: an
 * ordered history. The cap stops a hundred rows from taking ten seconds.
 */
export function useStagger(step = 0.045, maxTotal = 0.4) {
  const reduce = useReducedMotion();
  const container: Variants = {
    hidden: {},
    show: {
      transition: { staggerChildren: reduce ? 0 : step, delayChildren: 0 },
    },
  };
  const child: Variants = {
    hidden: reduce ? {} : { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE } },
  };
  return { container, child, cap: maxTotal };
}

/** Tactile press feedback. Confirms the click landed before anything loads. */
export function usePress() {
  const reduce = useReducedMotion();
  return reduce ? {} : ({ whileTap: { scale: 0.985 }, transition: spring } as const);
}

/** True when the visitor has asked for less movement. */
export { useReducedMotion };
