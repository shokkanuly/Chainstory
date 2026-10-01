// src/pages/Landing.tsx
//
// One page for both products, in the reference design's language: numbered
// sections, one accent colour each, glowing cards on a near-black canvas.
// Retold reads a wallet; Tripwire stops a bridge payout before it executes.
//
// Motion: a live silk field behind the hero only (it dissolves into plain
// canvas below, so body text never sits on moving light), a headline that
// decodes from hex, a receipt card that cycles real calldata into sentences,
// and sections whose headings set themselves as they arrive. All of it stops
// under prefers-reduced-motion.

import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useInView, useScroll, useTransform } from 'framer-motion';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import AnimatedNumber from '@/components/AnimatedNumber';
import ShaderField from '@/components/motion/ShaderField';
import DecodeText from '@/components/motion/DecodeText';
import RevealText from '@/components/motion/RevealText';
import VelocityMarquee from '@/components/motion/VelocityMarquee';
import { Magnetic, TiltCard } from '@/components/motion/pointer';
import { EASE, useReducedMotion, useRise } from '@/lib/motion';
import { INCIDENTS } from '@/tripwire/replay/incidents';
import { usd } from '@/tripwire/replay/format';
import '../styles/landing.css';

const TICKER = [
  'Plain English',
  'Draft FIFO',
  'Pre-sign risk',
  'Token approvals',
  'Bridge circuit breaker',
  '5 EVM networks',
  'Read-only by design',
];

const ANSWERS = [
  {
    label: 'Story feed',
    title: 'Readable history, block by block.',
    body: 'Swaps, transfers, bridges, mints and approvals, translated into a feed you can actually scan.',
    glow: 'var(--b-purple)',
    span: 'lg:row-span-2',
  },
  {
    label: 'Tax · Draft',
    title: 'FIFO cost basis without the fog.',
    body: 'A draft Form 8949 CSV with short and long-term lots, fees, and a clear paper trail.',
    glow: 'var(--b-cyan)',
  },
  {
    label: 'Approvals',
    title: 'See what can move.',
    body: 'Token allowances decoded from calldata — the contracts that can still spend your money.',
    glow: 'var(--b-amber)',
  },
  {
    label: 'Pre-sign risk',
    title: 'Pause before the click.',
    body: 'Verification, deploy age, proxy and admin signals, read before a signature becomes a story.',
    glow: 'var(--b-red)',
    span: 'lg:col-span-2',
  },
];

const NETWORKS = [
  { name: 'Ethereum', line: 'The original EVM ledger, translated one block at a time.', assets: 'ETH · ERC-20' },
  { name: 'Arbitrum', line: 'Rollup history with the same plain-English lens as mainnet.', assets: 'ETH · ERC-20' },
  { name: 'Base', line: 'Coinbase’s L2, read without connecting a wallet.', assets: 'ETH · ERC-20' },
  { name: 'Optimism', line: 'OP Mainnet activity, decoded and priced.', assets: 'ETH · ERC-20' },
  { name: 'Polygon', line: 'PoS chain history, including the long tail of token transfers.', assets: 'POL · ERC-20' },
];

const FAQ = [
  {
    q: 'Is Retold a wallet?',
    a: 'No. Retold is a read-only explainer. You paste a public address to inspect its history; no wallet connection, signature or approval is required.',
  },
  {
    q: 'Is the tax report final?',
    a: 'No. It is a draft Form 8949 CSV built with FIFO lot matching, from the most recent 100 transactions. Review it with a qualified tax professional before filing.',
  },
  {
    q: 'What is Tripwire?',
    a: 'A circuit breaker for bridges. Before a bridge pays out, it checks that the payout is backed by a burn it can verify, and if not, pauses just that route for 24 hours while a human reviews.',
  },
  {
    q: 'Is Tripwire live on a chain?',
    a: 'Not yet. The replay runs the real guardian contract in an EVM inside your browser, against reconstructions of three 2026 exploits. Sources and assumptions are listed on the page.',
  },
  {
    q: 'Which networks are supported?',
    a: 'Retold reads Ethereum, Arbitrum, Base, Optimism and Polygon. Tripwire’s guardian is one EVM contract that deploys unchanged to any of them.',
  },
];

const kelp = INCIDENTS.find((i) => i.id === 'kelp')!;

/**
 * The hero receipt cycles through three illustrative transactions. Each
 * calldata is real ABI encoding for its selector (the selectors are in
 * services/methodRegistry.ts); the parts that would name a specific
 * counterparty are elided rather than invented.
 */
const SAMPLES = [
  {
    story: 'Swapped 2.0 ETH for 3,400 USDC',
    meta: 'Uniswap router · Ethereum · 18:42 UTC',
    selector: '0x7ff36ab5',
    args: '00000000000000000000000000000000000000000000000000000000caa7e200…',
    cells: [
      ['Input', '2.0 ETH'],
      ['Output', '3,400 USDC'],
    ],
    tag: 'Trade',
    color: 'var(--b-cyan)',
  },
  {
    story: 'Granted unlimited USDC spending to a router',
    meta: 'ERC-20 approve · Base · 09:15 UTC',
    selector: '0x095ea7b3',
    args: '000000000000000000000000…ffffffffffffffffffffffffffffffff',
    cells: [
      ['Token', 'USDC'],
      ['Allowance', 'Unlimited'],
    ],
    tag: 'Approval',
    color: 'var(--b-amber)',
  },
  {
    story: 'Sent 1,200 USDC to 0x71c7…976f',
    meta: 'ERC-20 transfer · Arbitrum · 21:03 UTC',
    selector: '0xa9059cbb',
    args: '00000000000000000000000071c7656ec7ab88b098defb751b7401b5f6d8976f…47868c00',
    cells: [
      ['Amount', '1,200 USDC'],
      ['Recipient', '0x71c7…976f'],
    ],
    tag: 'Transfer',
    color: 'var(--b-purple)',
  },
] as const;

const CYCLE_MS = 5600;

export default function Landing() {
  return (
    <div className="l-page min-h-[100dvh] text-foreground">
      <Navbar />
      <Hero />
      <Ticker />
      <Answers />
      <Tripwire />
      <PutToWork />
      <Networks />
      <Faq />
      <Closing />
      <Footer />
    </div>
  );
}

// --- shared -------------------------------------------------------------------

function Section({ id, n, label, children, className = '' }: { id?: string; n: string; label: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6 sm:py-28 lg:px-8 ${className}`}>
      <p className="l-label">
        {n} / {label}
      </p>
      {children}
    </section>
  );
}

const glowStyle = (color: string) => ({ ['--glow' as string]: color, ['--spot' as string]: color }) as CSSProperties;

function useWide(query = '(min-width: 1024px)') {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return wide;
}

/** A card that rises out of the page in 3D as it scrolls in. */
function RiseCard({ children, className = '', style, delay = 0, as = 'article' }: { children: ReactNode; className?: string; style?: CSSProperties; delay?: number; as?: 'article' | 'div' }) {
  const reduce = useReducedMotion();
  const M = as === 'article' ? motion.article : motion.div;
  return (
    <M
      className={className}
      style={{ ...style, transformPerspective: 1200, transformOrigin: '50% 100%' }}
      initial={reduce ? false : { opacity: 0, y: 48, rotateX: -11 }}
      whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.95, ease: EASE, delay: reduce ? 0 : delay }}
    >
      {children}
    </M>
  );
}

// --- 01 hero ------------------------------------------------------------------

function Hero() {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  // As the hero scrolls away the light recedes and the layers part.
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const fieldOpacity = useTransform(scrollYProgress, [0, 0.9], [1, 0.15]);
  const fieldScale = useTransform(scrollYProgress, [0, 1], [1, 1.14]);
  const copyY = useTransform(scrollYProgress, [0, 1], [0, -90]);
  const cardY = useTransform(scrollYProgress, [0, 1], [0, -180]);
  const label = useRise(0.05);
  const body = useRise(0.55);
  const ctas = useRise(0.7);
  const line = useRise(0.85);

  return (
    <header ref={ref} className="relative isolate overflow-hidden">
      <motion.div className="absolute inset-0 -z-10" style={reduce ? undefined : { opacity: fieldOpacity, scale: fieldScale }}>
        <ShaderField className="fx-hero-field absolute inset-0" />
      </motion.div>
      <div className="fx-hero-veil pointer-events-none absolute inset-0 -z-10" />
      <div className="l-grid pointer-events-none absolute inset-0 -z-10" />

      <div className="relative mx-auto grid min-h-[min(100dvh,1000px)] max-w-7xl gap-14 px-4 pb-10 pt-32 sm:px-6 sm:pt-40 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:px-8">
        <motion.div className="min-w-0" style={reduce ? undefined : { y: copyY }}>
          <motion.p className="l-label" {...label}>
            01 / The readable chain
          </motion.p>
          <h1 className="l-display mt-6 text-[clamp(3.4rem,11vw,7.2rem)]">
            <DecodeText text="Onchain," duration={650} delay={150} />
            <br />
            <DecodeText
              text="understood."
              duration={900}
              delay={420}
              style={{ color: 'var(--b-purple)', ['--dc-glyph' as string]: 'var(--b-cyan)' }}
            />
          </h1>
          <motion.p className="l-body mt-7 max-w-xl sm:text-[1.125rem]" {...body}>
            <span className="text-foreground">Retold</span> turns any EVM wallet into plain-English history, a draft
            FIFO tax report and a sharper view of token approvals.{' '}
            <span className="text-foreground">Tripwire</span> stops a bridge paying out money that was never burned —
            before it executes.
          </motion.p>
          <motion.div className="mt-9 flex flex-wrap items-center gap-3" {...ctas}>
            <Magnetic>
              <button type="button" onClick={() => navigate('/app?address=vitalik.eth')} className="b-btn b-btn--primary">
                Analyse a wallet →
              </button>
            </Magnetic>
            <Magnetic strength={0.18}>
              <a href="/tripwire?incident=kelp" className="rounded-full border border-border bg-[color-mix(in_srgb,var(--b-canvas)_55%,transparent)] px-5 py-3 text-sm font-semibold backdrop-blur-sm transition-colors hover:bg-secondary">
                Watch Tripwire stop $292M ↘
              </a>
            </Magnetic>
          </motion.div>
          <motion.p className="mt-6 font-mono text-[12px] tracking-[0.08em] text-muted-foreground" {...line}>
            <span style={{ color: 'var(--b-cyan)' }}>READ-ONLY</span> · NO CONNECT · NO SIGN · NO APPROVAL
          </motion.p>
        </motion.div>
        <motion.div className="min-w-0" style={reduce ? undefined : { y: cardY }}>
          <TranslationCard />
        </motion.div>
      </div>
      <div className="pb-8 text-center">
        <p className="l-label">Scroll to decode</p>
        <div className="fx-cue mt-3" aria-hidden />
      </div>
    </header>
  );
}

function TranslationCard() {
  const reduce = useReducedMotion();
  const wide = useWide();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  // Cycles only while visible and not being read (hover or focus holds it).
  const auto = !reduce && inView && !held;

  useEffect(() => {
    if (!auto) return;
    const t = window.setTimeout(() => setIndex((n) => (n + 1) % SAMPLES.length), CYCLE_MS);
    return () => window.clearTimeout(t);
  }, [auto, index]);

  const s = SAMPLES[index];
  const enter = reduce ? false : { opacity: 0, y: 10, filter: 'blur(6px)' };

  return (
    <div ref={ref} onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)} onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}>
      <TiltCard
        baseX={wide ? 4 : 0}
        baseY={wide ? -9 : 0}
        max={wide ? 7 : 0}
        className="l-card overflow-hidden p-0 shadow-[0_40px_120px_-40px_rgba(166,100,252,0.45)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <span className="flex items-center gap-1.5" role="group" aria-label="Sample transactions">
            {SAMPLES.map((x, k) => (
              <button
                key={x.tag}
                type="button"
                onClick={() => setIndex(k)}
                aria-label={`Show sample ${k + 1}: ${x.tag}`}
                aria-pressed={k === index}
                className="relative h-2 overflow-hidden rounded-full transition-[width] duration-500"
                style={{ width: k === index ? 26 : 8, background: 'var(--b-line-strong)' }}
              >
                {k === index && (
                  <motion.span
                    key={`${index}-${auto}`}
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ background: s.color }}
                    initial={{ width: auto ? '0%' : '100%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: auto ? CYCLE_MS / 1000 : 0, ease: 'linear' }}
                  />
                )}
              </button>
            ))}
          </span>
          <span className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground">ILLUSTRATIVE SAMPLE · NOT LIVE DATA</span>
        </div>
        <div className="px-6 pb-6 pt-5">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full border border-border font-mono text-[12px]" style={{ color: 'var(--b-purple)' }}>
              0x
            </span>
            <div>
              <p className="l-label !text-[11px]">Public address</p>
              <p className="font-mono text-[14px]">0x7ff3…aB5000</p>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={s.tag}
                className="ml-auto rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em]"
                style={{ color: s.color, borderColor: `color-mix(in srgb, ${s.color} 45%, transparent)` }}
                initial={reduce ? false : { opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.3, ease: EASE }}
              >
                {s.tag}
              </motion.span>
            </AnimatePresence>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={index}
              initial={enter}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={reduce ? undefined : { opacity: 0, y: -8, filter: 'blur(6px)' }}
              transition={{ duration: 0.35, ease: EASE }}
            >
              {/* The raw calldata, typed out: this is what the wallet shows you. */}
              <motion.p
                className="mt-6 overflow-hidden text-ellipsis whitespace-nowrap rounded-lg border border-border px-3 py-2 font-mono text-[12px] text-muted-foreground"
                initial={reduce ? false : { clipPath: 'inset(0 100% 0 0)' }}
                animate={{ clipPath: 'inset(0 0% 0 0)' }}
                transition={{ duration: 0.7, ease: [0.65, 0, 0.35, 1] }}
              >
                <span style={{ color: s.color }}>{s.selector}</span>
                {s.args}
              </motion.p>
              <p className="mt-5 font-mono text-[11px] font-medium tracking-[0.12em]" style={{ color: 'var(--b-cyan)' }}>
                RETOLD TRANSLATION
              </p>
              {/* …and what Retold says it means. */}
              <DecodeText
                as="p"
                text={s.story}
                delay={reduce ? 0 : 520}
                duration={850}
                className="l-h3 mt-2 min-h-[2.1em] text-[clamp(1.6rem,3vw,2.3rem)]"
                style={{ ['--dc-glyph' as string]: s.color }}
              />
              <p className="mt-2 text-[14px] text-muted-foreground">{s.meta}</p>
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="grid grid-cols-2 border-t border-border">
          {s.cells.map(([k, v], i) => (
            <div key={k} className={`px-6 py-4 ${i === 1 ? 'border-l border-border' : ''}`}>
              <p className="l-label !text-[11px]">{k}</p>
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={`${index}-${v}`}
                  className="mt-1 font-mono text-[15px]"
                  initial={reduce ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.35, ease: EASE, delay: reduce ? 0 : 0.9 + i * 0.08 }}
                >
                  {v}
                </motion.p>
              </AnimatePresence>
            </div>
          ))}
        </div>
      </TiltCard>
    </div>
  );
}

function Ticker() {
  return (
    <div className="border-y border-border py-3.5">
      <VelocityMarquee>
        {TICKER.map((t) => (
          <span key={t} className="flex items-center gap-6 px-6 font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            <span style={{ color: 'var(--b-purple)' }}>+</span>
            {t}
          </span>
        ))}
      </VelocityMarquee>
    </div>
  );
}

// --- 02 retold -------------------------------------------------------------------

function Answers() {
  return (
    <Section id="answers" n="02" label="One address. Four answers.">
      <div className="mt-6 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <RevealText
          className="l-h2 max-w-3xl"
          parts={[{ text: 'The chain speaks in receipts.' }, { text: 'Retold gives it a voice.', color: 'var(--b-purple)' }]}
        />
        <p className="l-body max-w-xs !text-[15px]">
          No dashboard archaeology. No hex decoding. Just the useful sentence hiding inside the transaction.
        </p>
      </div>
      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {ANSWERS.map((a, i) => (
          <RiseCard key={a.label} delay={i * 0.09} className={`l-card fx-spot flex min-h-[240px] flex-col p-6 ${a.span ?? ''}`} style={glowStyle(a.glow)}>
            <p className="l-label">
              0{i + 1} / {a.label}
            </p>
            <h3 className="l-h3 mt-8 max-w-sm text-[clamp(1.6rem,2.6vw,2.2rem)]">{a.title}</h3>
            <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-muted-foreground">{a.body}</p>
            <AnswerVisual index={i} color={a.glow} />
            <span className="mt-auto self-end pt-6 font-mono text-[2.8rem] leading-none" style={{ color: a.glow }} aria-hidden>
              0{i + 1}
            </span>
          </RiseCard>
        ))}
      </div>
    </Section>
  );
}

/** A small live illustration per answer. Decorative; the card's words carry the meaning. */
function AnswerVisual({ index, color }: { index: number; color: string }) {
  const reduce = useReducedMotion();
  if (index === 0) {
    return (
      <ul className="mt-8 space-y-2" aria-hidden>
        {['Swapped 2.0 ETH for 3,400 USDC', 'Received 0.045 ETH from Lido', 'Bridged 1,200 USDC to Base', 'Minted 1 NFT on Optimism'].map((line, k) => (
          <li key={line} className="flex items-center gap-3 rounded-xl border border-border bg-[color-mix(in_srgb,var(--b-canvas)_50%,transparent)] px-3 py-2.5 text-[14px]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
            <DecodeText text={line} delay={250 + k * 280} duration={700} />
          </li>
        ))}
      </ul>
    );
  }
  if (index === 1) {
    // FIFO lots stacking up, oldest first.
    const lots = [38, 62, 30, 78, 52, 88, 44, 70];
    return (
      <div className="mt-6 flex h-14 items-end gap-1.5" aria-hidden>
        {lots.map((h, k) => (
          <motion.span
            key={k}
            className="flex-1 rounded-t-[4px]"
            style={{ height: `${h}%`, background: `color-mix(in srgb, ${color} ${30 + k * 8}%, transparent)`, transformOrigin: '50% 100%' }}
            initial={reduce ? false : { scaleY: 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 0.7, ease: EASE, delay: reduce ? 0 : 0.2 + k * 0.06 }}
          />
        ))}
      </div>
    );
  }
  if (index === 3) {
    const verdicts = [
      ['Green', 'var(--tw-clear, #1fa58f)'],
      ['Yellow', 'var(--tw-elevated, #b88a2c)'],
      ['Red', 'var(--tw-trip, #cf3a66)'],
    ] as const;
    return (
      <div className="mt-6 flex flex-wrap gap-2" aria-hidden>
        {verdicts.map(([word, c], k) => (
          <motion.span
            key={word}
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold"
            style={{ borderColor: `color-mix(in srgb, ${c} 55%, transparent)` }}
            initial={reduce ? false : { opacity: 0, scale: 1.5 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, amount: 0.8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 22, delay: reduce ? 0 : 0.3 + k * 0.22 }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: c }} />
            {word}
          </motion.span>
        ))}
      </div>
    );
  }
  return null;
}

// --- 03 tripwire -------------------------------------------------------------------

function Tripwire() {
  const reduce = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const inView = useInView(cardRef, { once: true, amount: 0.45 });
  const rows = [
    { label: 'What actually happened', value: kelp.reportedLossUsd, color: 'var(--b-text)' },
    { label: 'Tripwire, before execution', value: 0, color: 'var(--b-cyan)', stamp: true },
    { label: 'Tripwire, one block later', value: kelp.reportedLossUsd, color: 'var(--b-text-muted)' },
  ];
  return (
    <Section id="tripwire" n="03" label="Tripwire · a circuit breaker for bridges" className="border-t border-border">
      <div className="mt-6 grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <RevealText className="l-h2" parts={[{ text: 'Stop the drain' }, { text: 'before it executes.', color: 'var(--b-red)' }]} />
          <p className="l-body mt-6 max-w-xl">
            Every major bridge drain of 2026 was a single transaction — Kelp DAO, Verus, Syscoin. Anything that reacts
            after a transaction lands is too late. Tripwire checks one thing first:{' '}
            <span className="text-foreground">is this payout backed by a burn we can verify?</span> If not, it pauses
            that one route for 24 hours while a human looks.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Magnetic>
              <a href="/tripwire?incident=kelp" className="b-btn b-btn--primary">
                Watch the Kelp DAO replay →
              </a>
            </Magnetic>
            <a href="/tripwire" className="rounded-full border border-border px-5 py-3 text-sm font-semibold transition-colors hover:bg-secondary">
              All three incidents
            </a>
          </div>
        </div>
        <RiseCard as="div" className="l-card fx-spot p-0" style={glowStyle('var(--b-red)')}>
          <div ref={cardRef}>
            <p className="l-label border-b border-border px-6 py-4">
              {kelp.name} · replayed through the guardian contract
            </p>
            {/* The wire: the payout runs toward release and is cut at the guardian. */}
            <svg viewBox="0 0 400 28" className="block h-7 w-full px-6" aria-hidden preserveAspectRatio="none">
              <line x1="0" y1="14" x2="400" y2="14" stroke="var(--b-line-strong)" strokeWidth="1" strokeDasharray="3 5" />
              <motion.line
                x1="0"
                y1="14"
                x2="260"
                y2="14"
                stroke="var(--b-red)"
                strokeWidth="2"
                initial={reduce ? false : { pathLength: 0 }}
                animate={inView ? { pathLength: 1 } : undefined}
                transition={{ duration: 1.1, ease: [0.65, 0, 0.35, 1] }}
              />
              <motion.circle
                cx="260"
                cy="14"
                r="5"
                fill="var(--b-red)"
                initial={reduce ? false : { scale: 0 }}
                animate={inView ? { scale: [0, 1.8, 1] } : undefined}
                transition={{ duration: 0.6, delay: reduce ? 0 : 1.05 }}
                style={{ transformOrigin: '260px 14px' }}
              />
            </svg>
            <dl>
              {rows.map((r, k) => (
                <div key={r.label} className="flex items-baseline justify-between gap-4 border-b border-border px-6 py-5 last:border-0">
                  <dt className="text-[15px] text-muted-foreground">{r.label}</dt>
                  <motion.dd
                    className={`rounded-md px-1 font-mono text-[clamp(1.6rem,3vw,2.2rem)] tracking-[-0.03em] ${r.stamp && inView && !reduce ? 'fx-stamp' : ''}`}
                    style={{ color: r.color, ['--stamp' as string]: 'var(--b-cyan)' }}
                    initial={reduce ? false : { opacity: 0, scale: r.stamp ? 1.6 : 1, y: r.stamp ? 0 : 10 }}
                    animate={inView ? { opacity: 1, scale: 1, y: 0 } : undefined}
                    transition={r.stamp ? { type: 'spring', stiffness: 380, damping: 18, delay: reduce ? 0 : 1.15 } : { duration: 0.5, ease: EASE, delay: reduce ? 0 : 0.2 + k * 0.4 }}
                  >
                    {r.value === 0 ? usd(0) : <AnimatedNumber value={r.value} format={usd} />}
                  </motion.dd>
                </div>
              ))}
            </dl>
          </div>
        </RiseCard>
      </div>
    </Section>
  );
}

// --- 04 put it to work --------------------------------------------------------------

function PutToWork() {
  const navigate = useNavigate();
  const [address, setAddress] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const a = address.trim();
    navigate(a ? `/app?address=${encodeURIComponent(a)}` : '/app');
  };
  return (
    <Section id="demo" n="04" label="Put it to work" className="border-t border-border">
      <div className="mt-6 grid gap-12 lg:grid-cols-2 lg:items-center">
        <div>
          <RevealText className="l-h2" parts={[{ text: 'Paste an address.' }, { text: 'Get the plot.', color: 'var(--b-cyan)' }]} />
          <p className="l-body mt-6 max-w-md">
            Any public EVM address or ENS name. Retold never asks for a connection, a signature or an approval.
          </p>
          <form onSubmit={submit} className="fx-spot mt-8 flex max-w-lg items-center rounded-full border border-border bg-background p-1.5 transition-shadow focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--b-purple)_22%,transparent)]" style={glowStyle('var(--b-cyan)')}>
            <label htmlFor="l-address" className="sr-only">
              Wallet address or ENS name
            </label>
            <input
              id="l-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x… or name.eth"
              className="min-w-0 flex-1 bg-transparent px-4 font-mono text-[15px] outline-none placeholder:text-muted-foreground"
            />
            <button type="submit" className="b-btn b-btn--primary shrink-0" style={{ padding: '0.7rem 1.1rem' }}>
              Explain it →
            </button>
          </form>
          <p className="mt-3 font-mono text-[12px] text-muted-foreground">
            Try <button type="button" onClick={() => setAddress('vitalik.eth')} className="underline underline-offset-4 hover:text-foreground">vitalik.eth</button>
          </p>
        </div>
        <RiseCard as="div" className="l-card fx-spot p-0" style={glowStyle('var(--b-cyan)')}>
          <p className="l-label flex justify-between border-b border-border px-6 py-4">
            <span>Story feed / read-only</span>
            <span style={{ color: 'var(--b-amber)' }}>Illustrative</span>
          </p>
          <ul className="divide-y divide-border">
            {[
              ['Swapped 2.0 ETH for 3,400 USDC on Uniswap', 'Trade'],
              ['Received 0.045 ETH in staking rewards from Lido', 'Income'],
              ['Granted unlimited USDC spending to a router', 'Approval'],
              ['Bridged 1,200 USDC from Ethereum to Base', 'Transfer'],
            ].map(([line, tag], k) => (
              <li key={line} className="flex items-center justify-between gap-4 px-6 py-4">
                <DecodeText text={line} delay={200 + k * 260} duration={750} className="text-[15px]" />
                <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{tag}</span>
              </li>
            ))}
          </ul>
        </RiseCard>
      </div>
    </Section>
  );
}

// --- 05 networks -------------------------------------------------------------------

function Networks() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const n = NETWORKS[active];
  return (
    <Section id="networks" n="05" label="Same language, five worlds" className="border-t border-border">
      <div className="mt-6 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <RevealText className="l-h2" parts={[{ text: 'Built for the' }, { text: 'EVM sprawl.', color: 'var(--b-amber)' }]} />
        <p className="l-body max-w-xs !text-[15px]">One read-only lens across the networks where your wallet history actually lives.</p>
      </div>
      <div className="l-card mt-12 grid grid-cols-2 overflow-hidden p-0 sm:grid-cols-5" role="tablist" aria-label="Networks">
        {NETWORKS.map((net, i) => (
          <button
            key={net.name}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className="relative border-b border-r border-border px-5 py-4 text-left transition-colors hover:bg-secondary"
          >
            {i === active && (
              <motion.span
                layoutId="l-net-active"
                className="absolute inset-0"
                style={{ background: 'color-mix(in oklab, var(--b-purple) 14%, transparent)', boxShadow: 'inset 0 -2px 0 var(--b-purple)' }}
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 36 }}
              />
            )}
            <span className="relative">
              <span className="l-label !text-[11px]">0{i + 1}</span>
              <span className="mt-2 block text-[15px] font-medium">{net.name}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="l-card mt-4 overflow-hidden p-6" role="tabpanel">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={n.name}
            className="grid gap-6 md:grid-cols-[1.4fr_1fr_1fr]"
            initial={reduce ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? undefined : { opacity: 0, x: -24 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <div>
              <p className="l-label">{n.name} / selected network</p>
              <DecodeText as="p" text={n.line} duration={700} className="mt-3 block text-xl leading-snug tracking-[-0.02em]" />
            </div>
            <div className="md:border-l md:border-border md:pl-6">
              <p className="l-label">Context layer</p>
              <p className="mt-3 font-mono" style={{ color: 'var(--b-cyan)' }}>PLAIN ENGLISH</p>
            </div>
            <div className="md:border-l md:border-border md:pl-6">
              <p className="l-label">Readable assets</p>
              <p className="mt-3 font-mono" style={{ color: 'var(--b-cyan)' }}>{n.assets}</p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </Section>
  );
}

// --- 06 faq -------------------------------------------------------------------------

function Faq() {
  return (
    <Section id="faq" n="06" label="The fine print, upfront" className="border-t border-border">
      <div className="mt-6 grid gap-12 lg:grid-cols-[1fr_1.3fr]">
        <RevealText className="l-h2" parts={[{ text: 'Sharp about what it is.' }, { text: 'Sharper about what it is not.', color: 'var(--b-purple)' }]} />
        <div className="divide-y divide-border border-y border-border">
          {FAQ.map((f) => (
            <details key={f.q} className="l-faq group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[16px] font-medium">
                {f.q}
                <span className="l-faq-plus text-xl transition-transform duration-300" style={{ color: 'var(--b-purple)' }} aria-hidden>
                  +
                </span>
              </summary>
              <p className="l-faq-a pb-5 pr-8 text-[15px] leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

// --- 07 closing ----------------------------------------------------------------------

function Closing() {
  return (
    // The only colour below the hero: a still horizon of the same light.
    <div className="fx-horizon border-t border-border">
      <Section n="07" label="Start with the story" className="pb-32 text-center sm:pb-40">
        <RevealText
          className="l-h2 mx-auto mt-6 max-w-4xl"
          parts={[{ text: 'Your wallet has a history.' }, { text: 'Make it legible.', color: 'var(--b-purple)' }]}
        />
        <p className="l-body mx-auto mt-6 max-w-md">Read-only by design, useful by default.</p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Magnetic>
            <a href="/app?address=vitalik.eth" className="b-btn b-btn--primary">
              Analyse a wallet →
            </a>
          </Magnetic>
          <a href="/tripwire?incident=kelp" className="rounded-full border border-border bg-[color-mix(in_srgb,var(--b-canvas)_55%,transparent)] px-5 py-3 text-sm font-semibold transition-colors hover:bg-secondary">
            Watch Tripwire
          </a>
        </div>
      </Section>
    </div>
  );
}
