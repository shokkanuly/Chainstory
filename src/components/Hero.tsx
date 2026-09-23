// src/components/Hero.tsx
//
// Built to the design board: a gradient identity card carrying uppercase
// display type and a black pill CTA.
//
// Two rules from styles/brand.css are load-bearing here. The gradient appears
// once, as this card, and nowhere else on the screen. The primary action is
// ink, not brand colour, which is what stops the gradient reading as
// decoration and keeps the CTA legible over any part of it.

import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Shield, Zap, FileText } from 'lucide-react';

interface Props {
  onAnalyze?: (addresses: string[]) => void;
}

const ASSURANCES = [
  { icon: Shield, title: 'No wallet connection', desc: 'Read-only. Nothing to sign, nothing to approve.' },
  { icon: Zap, title: 'Instant classification', desc: 'Deterministic rules engine, runs locally.' },
  { icon: FileText, title: 'Draft Form 8949', desc: 'FIFO cost basis, CSV and PDF export.' },
];

export default function Hero({ onAnalyze }: Props) {
  const reduce = useReducedMotion();
  const rise = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const },
  });

  return (
    <section className="bg-background pt-24 pb-20">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
        {/* The identity card. One gradient per screen. */}
        <motion.div
          {...rise(0.05)}
          className="b-gradient relative overflow-hidden px-6 py-16 sm:px-14 sm:py-24"
          style={{ borderRadius: 'var(--b-r-lg)' }}
        >
          <div className="max-w-[46rem]">
            <span
              className="b-pill"
              style={{ background: 'rgba(255,255,255,0.92)', color: 'var(--b-ink)' }}
            >
              New · Multi-chain
            </span>

            <h1
              className="b-display mt-7 text-white text-[clamp(2.5rem,7.5vw,4.75rem)]"
              style={{ paddingBottom: '0.06em' }}
            >
              See every chain.
            </h1>

            <p
              className="mt-6 max-w-[34rem] text-[15px] sm:text-[17px] leading-relaxed"
              style={{ color: 'var(--b-on-ink-muted)' }}
            >
              Paste an address. Get the story, the taxes and the risk in plain English.
              No wallet connection, no signup.
            </p>

            <div className="mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <button
                onClick={() => onAnalyze?.(['vitalik.eth'])}
                className="b-btn b-btn--primary"
              >
                Analyse a wallet
                <ArrowRight className="h-4 w-4" />
              </button>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center px-2 py-3 text-sm font-semibold text-white underline underline-offset-[6px] decoration-white/45 transition-colors hover:decoration-white"
              >
                How it works
              </a>
            </div>
          </div>
        </motion.div>

        {/* Assurances sit below the card as plain rows. Cards here would add
            chrome without adding hierarchy. */}
        <motion.ul
          {...rise(0.18)}
          className="mt-12 grid gap-x-10 gap-y-7 sm:grid-cols-3"
        >
          {ASSURANCES.map((item) => (
            <li key={item.title} className="flex gap-3.5">
              <item.icon
                className="mt-0.5 h-[18px] w-[18px] shrink-0"
                style={{ color: 'var(--b-text-muted)' }}
                strokeWidth={1.75}
              />
              <div>
                <div className="text-[13.5px] font-semibold leading-tight">{item.title}</div>
                <div className="mt-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--b-text-muted)' }}>
                  {item.desc}
                </div>
              </div>
            </li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
