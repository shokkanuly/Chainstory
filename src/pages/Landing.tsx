// src/pages/Landing.tsx
//
// One page for both products, in the reference design's language: numbered
// sections, one accent colour each, glowing cards on a near-black ledger grid.
// Retold reads a wallet; Tripwire stops a bridge payout before it executes.

import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
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

const Accent = ({ color, children }: { color: string; children: ReactNode }) => <span style={{ color }}>{children}</span>;

// --- 01 hero ------------------------------------------------------------------

function Hero() {
  const navigate = useNavigate();
  return (
    <header className="relative overflow-hidden">
      <div className="l-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid max-w-7xl gap-14 px-4 pb-16 pt-32 sm:px-6 sm:pt-40 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:px-8">
        <div>
          <p className="l-label">01 / The readable chain</p>
          <h1 className="l-display mt-6 text-[clamp(3.4rem,11vw,7.2rem)]">
            Onchain,
            <br />
            <Accent color="var(--b-purple)">understood.</Accent>
          </h1>
          <p className="mt-7 max-w-xl text-[16px] leading-relaxed text-muted-foreground sm:text-[17px]">
            <span className="text-foreground">Retold</span> turns any EVM wallet into plain-English history, a draft
            FIFO tax report and a sharper view of token approvals.{' '}
            <span className="text-foreground">Tripwire</span> stops a bridge paying out money that was never burned —
            before it executes.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => navigate('/app?address=vitalik.eth')} className="b-btn b-btn--primary">
              Analyse a wallet →
            </button>
            <a href="/tripwire?incident=kelp" className="rounded-full border border-border px-5 py-3 text-sm font-semibold transition-colors hover:bg-secondary">
              Watch Tripwire stop $292M ↘
            </a>
          </div>
          <p className="mt-6 font-mono text-[11px] tracking-[0.14em] text-muted-foreground">
            <span style={{ color: 'var(--b-cyan)' }}>READ-ONLY</span> · NO CONNECT · NO SIGN · NO APPROVAL
          </p>
        </div>
        <TranslationCard />
      </div>
      <p className="l-label pb-8 text-center">Scroll to decode</p>
    </header>
  );
}

function TranslationCard() {
  return (
    <div className="l-tilt l-card overflow-hidden p-0 shadow-[0_40px_120px_-40px_rgba(166,100,252,0.45)]">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="flex gap-1.5">
          <i className="h-2 w-2 rounded-full" style={{ background: 'var(--b-purple)' }} />
          <i className="h-2 w-2 rounded-full bg-[var(--b-line-strong)]" />
          <i className="h-2 w-2 rounded-full bg-[var(--b-line-strong)]" />
        </span>
        <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground">ILLUSTRATIVE SAMPLE / NOT LIVE DATA</span>
      </div>
      <div className="px-6 pb-6 pt-5">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full border border-border font-mono text-[11px]" style={{ color: 'var(--b-purple)' }}>
            0x
          </span>
          <div>
            <p className="l-label !text-[10px]">Public address</p>
            <p className="font-mono text-[13px]">0x7ff3…aB5000</p>
          </div>
        </div>
        <p className="mt-6 font-mono text-[10px] tracking-[0.17em]" style={{ color: 'var(--b-cyan)' }}>
          RETOLD TRANSLATION
        </p>
        <p className="mt-2 text-[clamp(1.6rem,3vw,2.3rem)] leading-[1.05] tracking-[-0.04em]">Swapped 2.0 ETH for 3,400 USDC</p>
        <p className="mt-2 text-sm text-muted-foreground">Uniswap V3 · Ethereum · 18:42 UTC</p>
        <p className="mt-4 rounded-lg border border-border px-3 py-2 font-mono text-[11px] text-muted-foreground">
          0x7ff36ab5000000000000000000000000000000…
        </p>
      </div>
      <div className="grid grid-cols-2 border-t border-border">
        <div className="px-6 py-4">
          <p className="l-label !text-[10px]">Input</p>
          <p className="mt-1 font-mono">2.0 ETH</p>
        </div>
        <div className="border-l border-border px-6 py-4">
          <p className="l-label !text-[10px]">Output</p>
          <p className="mt-1 font-mono">3,400 USDC</p>
        </div>
      </div>
    </div>
  );
}

function Ticker() {
  const row = [...TICKER, ...TICKER];
  return (
    <div className="overflow-hidden border-y border-border py-3" aria-hidden>
      <div className="l-marquee">
        {[row, row].map((items, k) => (
          <span key={k} className="flex shrink-0">
            {items.map((t, i) => (
              <span key={i} className="flex items-center gap-6 px-6 font-mono text-[11px] uppercase tracking-[0.17em] text-muted-foreground">
                <span style={{ color: 'var(--b-purple)' }}>+</span>
                {t}
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}

// --- 02 retold -------------------------------------------------------------------

function Answers() {
  return (
    <Section id="answers" n="02" label="One address. Four answers.">
      <div className="mt-6 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <h2 className="l-h2 max-w-3xl">
          The chain speaks in receipts. <Accent color="var(--b-purple)">Retold gives it a voice.</Accent>
        </h2>
        <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
          No dashboard archaeology. No hex decoding. Just the useful sentence hiding inside the transaction.
        </p>
      </div>
      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {ANSWERS.map((a, i) => (
          <article key={a.label} className={`l-card relative flex min-h-[220px] flex-col p-6 ${a.span ?? ''}`} style={{ ['--glow' as string]: a.glow }}>
            <p className="l-label">
              0{i + 1} / {a.label}
            </p>
            <h3 className="mt-8 max-w-sm text-[clamp(1.6rem,2.6vw,2.2rem)] leading-[1.02] tracking-[-0.045em]">{a.title}</h3>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">{a.body}</p>
            <span className="mt-auto self-end pt-6 font-mono text-[2.8rem] leading-none" style={{ color: a.glow }}>
              0{i + 1}
            </span>
          </article>
        ))}
      </div>
    </Section>
  );
}

// --- 03 tripwire -------------------------------------------------------------------

function Tripwire() {
  const rows = [
    { label: 'What actually happened', value: usd(kelp.reportedLossUsd), color: 'var(--b-text)' },
    { label: 'Tripwire, before execution', value: '$0', color: 'var(--b-cyan)' },
    { label: 'Tripwire, one block later', value: usd(kelp.reportedLossUsd), color: 'var(--b-text-muted)' },
  ];
  return (
    <Section id="tripwire" n="03" label="Tripwire · a circuit breaker for bridges" className="border-t border-border">
      <div className="mt-6 grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <h2 className="l-h2">
            Stop the drain <Accent color="var(--b-red)">before it executes.</Accent>
          </h2>
          <p className="mt-6 max-w-xl leading-relaxed text-muted-foreground">
            Every major bridge drain of 2026 was a single transaction — Kelp DAO, Verus, Syscoin. Anything that reacts
            after a transaction lands is too late. Tripwire checks one thing first:{' '}
            <span className="text-foreground">is this payout backed by a burn we can verify?</span> If not, it pauses
            that one route for 24 hours while a human looks.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/tripwire?incident=kelp" className="b-btn b-btn--primary">
              Watch the Kelp DAO replay →
            </a>
            <a href="/tripwire" className="rounded-full border border-border px-5 py-3 text-sm font-semibold transition-colors hover:bg-secondary">
              All three incidents
            </a>
          </div>
        </div>
        <div className="l-card p-0" style={{ ['--glow' as string]: 'var(--b-red)' }}>
          <p className="l-label border-b border-border px-6 py-4">
            {kelp.name} · replayed through the guardian contract
          </p>
          <dl>
            {rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-4 border-b border-border px-6 py-5 last:border-0">
                <dt className="text-sm text-muted-foreground">{r.label}</dt>
                <dd className="font-mono text-[clamp(1.6rem,3vw,2.2rem)] tracking-[-0.03em]" style={{ color: r.color }}>
                  {r.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
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
          <h2 className="l-h2">
            Paste an address. <Accent color="var(--b-cyan)">Get the plot.</Accent>
          </h2>
          <p className="mt-6 max-w-md leading-relaxed text-muted-foreground">
            Any public EVM address or ENS name. Retold never asks for a connection, a signature or an approval.
          </p>
          <form onSubmit={submit} className="mt-8 flex max-w-lg items-center rounded-full border border-border bg-background p-1.5">
            <label htmlFor="l-address" className="sr-only">
              Wallet address or ENS name
            </label>
            <input
              id="l-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x… or name.eth"
              className="min-w-0 flex-1 bg-transparent px-4 font-mono text-sm outline-none placeholder:text-muted-foreground"
            />
            <button type="submit" className="b-btn b-btn--primary shrink-0" style={{ padding: '0.7rem 1.1rem' }}>
              Explain it →
            </button>
          </form>
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            Try <button type="button" onClick={() => setAddress('vitalik.eth')} className="underline underline-offset-4 hover:text-foreground">vitalik.eth</button>
          </p>
        </div>
        <div className="l-card p-0" style={{ ['--glow' as string]: 'var(--b-cyan)' }}>
          <p className="l-label flex justify-between border-b border-border px-6 py-4">
            <span>Story feed / read-only</span>
            <span style={{ color: 'var(--b-amber)' }}>Illustrative</span>
          </p>
          <ul className="divide-y divide-border">
            {[
              ['Swapped 2.0 ETH for 3,400 USDC on Uniswap V3', 'Trade'],
              ['Received 0.045 ETH in staking rewards from Lido', 'Income'],
              ['Granted unlimited USDC spending to a router', 'Approval'],
              ['Bridged 1,200 USDC from Ethereum to Base', 'Transfer'],
            ].map(([line, tag]) => (
              <li key={line} className="flex items-center justify-between gap-4 px-6 py-4">
                <span className="text-[15px]">{line}</span>
                <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{tag}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

// --- 05 networks -------------------------------------------------------------------

function Networks() {
  const [active, setActive] = useState(0);
  const n = NETWORKS[active];
  return (
    <Section id="networks" n="05" label="Same language, five worlds" className="border-t border-border">
      <div className="mt-6 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <h2 className="l-h2">
          Built for the <Accent color="var(--b-amber)">EVM sprawl.</Accent>
        </h2>
        <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
          One read-only lens across the networks where your wallet history actually lives.
        </p>
      </div>
      <div className="l-card mt-12 grid grid-cols-2 overflow-hidden p-0 sm:grid-cols-5" role="tablist" aria-label="Networks">
        {NETWORKS.map((net, i) => (
          <button
            key={net.name}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className="border-b border-r border-border px-5 py-4 text-left transition-colors hover:bg-secondary aria-selected:bg-[color-mix(in_oklab,var(--b-purple)_12%,transparent)]"
          >
            <span className="l-label !text-[10px]">0{i + 1}</span>
            <span className="mt-2 block text-sm font-medium">{net.name}</span>
          </button>
        ))}
      </div>
      <div className="l-card mt-4 grid gap-6 p-6 md:grid-cols-[1.4fr_1fr_1fr]" role="tabpanel">
        <div>
          <p className="l-label">{n.name} / selected network</p>
          <p className="mt-3 text-xl leading-snug tracking-[-0.02em]">{n.line}</p>
        </div>
        <div className="md:border-l md:border-border md:pl-6">
          <p className="l-label">Context layer</p>
          <p className="mt-3 font-mono" style={{ color: 'var(--b-cyan)' }}>PLAIN ENGLISH</p>
        </div>
        <div className="md:border-l md:border-border md:pl-6">
          <p className="l-label">Readable assets</p>
          <p className="mt-3 font-mono" style={{ color: 'var(--b-cyan)' }}>{n.assets}</p>
        </div>
      </div>
    </Section>
  );
}

// --- 06 faq -------------------------------------------------------------------------

function Faq() {
  return (
    <Section id="faq" n="06" label="The fine print, upfront" className="border-t border-border">
      <div className="mt-6 grid gap-12 lg:grid-cols-[1fr_1.3fr]">
        <h2 className="l-h2">
          Sharp about what it is. <Accent color="var(--b-purple)">Sharper about what it is not.</Accent>
        </h2>
        <div className="divide-y divide-border border-y border-border">
          {FAQ.map((f) => (
            <details key={f.q} className="l-faq group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[15px] font-medium">
                {f.q}
                <span className="l-faq-plus text-xl transition-transform" style={{ color: 'var(--b-purple)' }} aria-hidden>
                  +
                </span>
              </summary>
              <p className="pb-5 pr-8 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
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
    <Section n="07" label="Start with the story" className="border-t border-border text-center">
      <h2 className="l-h2 mx-auto mt-6 max-w-4xl">
        Your wallet has a history. <Accent color="var(--b-purple)">Make it legible.</Accent>
      </h2>
      <p className="mx-auto mt-6 max-w-md text-muted-foreground">Read-only by design, useful by default.</p>
      <div className="mt-9 flex flex-wrap justify-center gap-3">
        <a href="/app?address=vitalik.eth" className="b-btn b-btn--primary">
          Analyse a wallet →
        </a>
        <a href="/tripwire?incident=kelp" className="rounded-full border border-border px-5 py-3 text-sm font-semibold transition-colors hover:bg-secondary">
          Watch Tripwire
        </a>
      </div>
    </Section>
  );
}
