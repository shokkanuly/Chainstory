// src/components/motion/pointer.tsx
//
// Motion that answers the pointer. Feedback, in the motion.ts sense: the
// surface you are over lights up where you are, the card under your hand
// leans toward it, the primary action leans in to meet you.
//
// Under reduced motion, or on a touch screen with no hover, all three stay
// still. None of them moves layout; they are transforms and paint only.

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useReducedMotion } from '@/lib/motion';

const canHover = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * One listener for the whole app. Any element with the `fx-spot` class (and
 * every `b-card`) gets
 * --mx / --my set to the pointer's position inside it, which styles/motion.css
 * turns into a soft light on the fill and the border.
 */
export function SpotlightTracker() {
  useEffect(() => {
    if (!canHover()) return;
    let current: HTMLElement | null = null;
    const onMove = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>('.fx-spot, .b-card') : null;
      if (current && current !== target) current.removeAttribute('data-spot');
      current = target;
      if (!target) return;
      const r = target.getBoundingClientRect();
      target.style.setProperty('--mx', `${e.clientX - r.left}px`);
      target.style.setProperty('--my', `${e.clientY - r.top}px`);
      target.setAttribute('data-spot', '');
    };
    const onLeave = () => {
      current?.removeAttribute('data-spot');
      current = null;
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, []);
  return null;
}

/** A wrapper that drifts toward the pointer while it is over it, and springs back on leave. */
export function Magnetic({ children, strength = 0.28, className }: { children: ReactNode; strength?: number; className?: string }) {
  const reduce = useReducedMotion();
  const x = useSpring(0, { stiffness: 260, damping: 18, mass: 0.6 });
  const y = useSpring(0, { stiffness: 260, damping: 18, mass: 0.6 });
  const ref = useRef<HTMLSpanElement>(null);

  if (reduce) return <span className={className}>{children}</span>;

  return (
    <motion.span
      ref={ref}
      className={`inline-flex ${className ?? ''}`}
      style={{ x, y }}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return;
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.span>
  );
}

/**
 * A card that tilts toward the pointer in 3D, with a glare that follows it.
 * `baseX` / `baseY` are the resting angles, so a card can lean at rest (the
 * hero receipt does) and still respond.
 */
export function TiltCard({
  children,
  className,
  style,
  baseX = 0,
  baseY = 0,
  max = 8,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  baseX?: number;
  baseY?: number;
  max?: number;
}) {
  const reduce = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const sx = useSpring(px, { stiffness: 140, damping: 20 });
  const sy = useSpring(py, { stiffness: 140, damping: 20 });
  const rotateY = useTransform(sx, [0, 1], [baseY - max, baseY + max]);
  const rotateX = useTransform(sy, [0, 1], [baseX + max, baseX - max]);
  const gx = useTransform(sx, (v) => `${v * 100}%`);
  const gy = useTransform(sy, (v) => `${v * 100}%`);
  const glare = useMotionTemplate`radial-gradient(520px circle at ${gx} ${gy}, color-mix(in srgb, var(--b-text) 9%, transparent), transparent 55%)`;

  if (reduce) {
    return (
      <div className={className} style={{ ...style, transform: `perspective(1400px) rotateX(${baseX}deg) rotateY(${baseY}deg)` }}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      className={`relative ${className ?? ''}`}
      style={{ ...style, rotateX, rotateY, transformPerspective: 1400 }}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return;
        const r = e.currentTarget.getBoundingClientRect();
        px.set((e.clientX - r.left) / r.width);
        py.set((e.clientY - r.top) / r.height);
      }}
      onPointerLeave={() => {
        px.set(0.5);
        py.set(0.5);
      }}
    >
      {children}
      <motion.span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: glare }} />
    </motion.div>
  );
}
