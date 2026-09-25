// src/prototype/PrototypeApp.tsx
//
// v2 shell. App-first, not marketing-first: the current build buries a wallet
// analyser inside a landing page, so the thing people came for is four scrolls
// down. Here the workspace IS the page, the way a wallet opens straight onto
// your holdings.

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  PulseIcon,
  ReceiptIcon,
  KeyIcon,
  ShieldCheckIcon,
  MagnifyingGlassIcon,
  CaretDownIcon,
  CopyIcon,
  CheckIcon,
  BookmarkSimpleIcon,
  WarningIcon,
} from '@phosphor-icons/react';

import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './tokens.css';

import { CHAINS, WALLET, type Chain } from './sampleData';
import { AddressAvatar, ChainMark } from './primitives';
import { truncate, usd } from './format';
import {
  ActivityPanel,
  ActivitySkeleton,
  ApprovalsPanel,
  EmptyState,
  IntelligencePanel,
  RiskPanel,
  TaxPanel,
} from './panels';
import Logo from '../components/ui/Logo';

type TabId = 'activity' | 'taxes' | 'approvals' | 'risk';
type View = 'empty' | 'loading' | 'loaded';

const TABS: { id: TabId; label: string; icon: typeof PulseIcon }[] = [
  { id: 'activity', label: 'Activity', icon: PulseIcon },
  { id: 'taxes', label: 'Taxes', icon: ReceiptIcon },
  { id: 'approvals', label: 'Approvals', icon: KeyIcon },
  { id: 'risk', label: 'Risk', icon: ShieldCheckIcon },
];

/* ---- Chrome ---------------------------------------------------------- */

function Rail({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  return (
    <aside
      className="hidden w-[212px] shrink-0 flex-col border-r px-3 py-4 lg:flex"
      style={{ borderColor: 'var(--v2-line)', background: 'var(--v2-canvas)' }}
    >
      <div className="flex items-center gap-2.5 px-2 pb-5">
        <Logo height={20} />
      </div>

      <nav className="flex flex-col gap-0.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="v2-nav-item w-full text-left"
            aria-current={active === t.id ? 'page' : undefined}
            onClick={() => onChange(t.id)}
          >
            <t.icon size={16} weight={active === t.id ? 'fill' : 'regular'} />
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mt-auto px-2">
        <div
          className="rounded-[var(--v2-r-card)] border p-3.5"
          style={{ borderColor: 'var(--v2-line)', background: 'var(--v2-surface)' }}
        >
          <p className="text-[12px] font-medium">Watchlist</p>
          <p className="mt-1 text-[11.5px] leading-relaxed" style={{ color: 'var(--v2-text-faint)' }}>
            Save a wallet to compare its history across sessions.
          </p>
          <button className="v2-btn v2-btn--ghost mt-3 w-full">
            <BookmarkSimpleIcon size={14} weight="bold" />
            Save wallet
          </button>
        </div>
      </div>
    </aside>
  );
}

function TopBar({
  chain,
  onChain,
  onSearch,
}: {
  chain: Chain | 'all';
  onChain: (c: Chain | 'all') => void;
  onSearch: () => void;
}) {
  const [open, setOpen] = useState(false);
  const current = CHAINS.find((c) => c.id === chain);

  return (
    <header
      className="sticky top-0 z-20 flex h-[68px] items-center gap-3 border-b px-4 sm:px-6"
      style={{ borderColor: 'var(--v2-line)', background: 'color-mix(in srgb, var(--v2-canvas) 88%, transparent)', backdropFilter: 'blur(12px)' }}
    >
      <div className="relative flex-1 max-w-[560px]">
        <MagnifyingGlassIcon
          size={15}
          weight="bold"
          style={{ color: 'var(--v2-text-faint)' }}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
        />
        <label htmlFor="v2-search" className="sr-only">
          Wallet address or ENS name
        </label>
        <input
          id="v2-search"
          className="v2-input pl-10"
          placeholder="Address or ENS name"
          defaultValue={WALLET.ens}
          onKeyDown={(e) => e.key === 'Enter' && onSearch()}
        />
      </div>

      <div className="relative">
        <button
          className="v2-btn v2-btn--ghost"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          {current ? <ChainMark chain={current.id} size={15} /> : null}
          <span className="hidden sm:inline">{current ? current.label : 'All chains'}</span>
          <CaretDownIcon size={12} weight="bold" style={{ color: 'var(--v2-text-faint)' }} />
        </button>

        {open && (
          <div
            role="listbox"
            className="absolute right-0 top-[calc(100%+6px)] z-30 w-[184px] overflow-hidden rounded-[var(--v2-r-control)] border py-1"
            style={{ borderColor: 'var(--v2-line-strong)', background: 'var(--v2-overlay)' }}
          >
            <button
              role="option"
              aria-selected={chain === 'all'}
              className="v2-nav-item w-full"
              onClick={() => {
                onChain('all');
                setOpen(false);
              }}
            >
              All chains
            </button>
            {CHAINS.map((c) => (
              <button
                key={c.id}
                role="option"
                aria-selected={chain === c.id}
                className="v2-nav-item w-full"
                onClick={() => {
                  onChain(c.id);
                  setOpen(false);
                }}
              >
                <ChainMark chain={c.id} size={15} />
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button className="v2-btn v2-btn--primary" onClick={onSearch}>
        Analyse
      </button>
    </header>
  );
}

function WalletHeader() {
  const [copied, setCopied] = useState(false);
  const up = WALLET.portfolioChangePct >= 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(WALLET.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable, the address is visible anyway */
    }
  };

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3.5">
        <AddressAvatar address={WALLET.address} size={46} />
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold tracking-[-0.03em]">{WALLET.ens}</h1>
          <button
            onClick={copy}
            className="v2-hash mt-1 flex items-center gap-1.5 transition-colors hover:text-[var(--v2-text)]"
          >
            {truncate(WALLET.address, 10, 8)}
            {copied ? (
              <CheckIcon size={12} weight="bold" style={{ color: 'var(--v2-gain)' }} />
            ) : (
              <CopyIcon size={12} weight="bold" />
            )}
          </button>
        </div>
      </div>

      {/* Figures sit in bare columns. A card here would add chrome, not hierarchy. */}
      <div className="flex items-center gap-7 sm:gap-9">
        <div>
          <div className="text-[11.5px]" style={{ color: 'var(--v2-text-faint)' }}>
            Portfolio
          </div>
          <div className="v2-num mt-1 text-[21px] font-medium tracking-[-0.03em]">
            {usd(WALLET.portfolioUsd)}
          </div>
        </div>
        <div>
          <div className="text-[11.5px]" style={{ color: 'var(--v2-text-faint)' }}>
            24h
          </div>
          <div
            className="v2-num mt-1 text-[21px] font-medium tracking-[-0.03em]"
            style={{ color: up ? 'var(--v2-gain)' : 'var(--v2-loss)' }}
          >
            {up ? '+' : ''}
            {WALLET.portfolioChangePct.toFixed(2)}%
          </div>
        </div>
      </div>
    </div>
  );
}

function TabBar({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  const reduce = useReducedMotion();
  return (
    <div className="v2-tabscroll -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div
        role="tablist"
        aria-label="Wallet views"
        className="inline-flex gap-0.5 rounded-[var(--v2-r-control)] border p-1"
        style={{ borderColor: 'var(--v2-line)', background: 'var(--v2-surface)' }}
      >
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          id={`v2-tab-${t.id}`}
          aria-controls={`v2-panel-${t.id}`}
          aria-selected={active === t.id}
          aria-label={t.label}
          className="v2-tab"
          onClick={() => onChange(t.id)}
        >
          {active === t.id && (
            <motion.span
              // Shared indicator: shows which view you moved to, and from where.
              layoutId="v2-tab-indicator"
              className="absolute inset-0 rounded-[7px]"
              style={{ background: 'var(--v2-raised)' }}
              transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
            />
          )}
          <span className="relative flex items-center gap-1.5">
            <t.icon size={14} weight={active === t.id ? 'fill' : 'regular'} />
            {t.label}
          </span>
        </button>
        ))}
      </div>
    </div>
  );
}

function DemoNotice() {
  return (
    <div
      className="flex items-start gap-2.5 rounded-[var(--v2-r-card)] border px-4 py-3"
      style={{ borderColor: 'color-mix(in srgb, var(--v2-warn) 26%, transparent)', background: 'var(--v2-warn-wash)' }}
    >
      <WarningIcon size={15} weight="bold" style={{ color: 'var(--v2-warn)', flexShrink: 0, marginTop: 1 }} />
      <p className="text-[12px] leading-relaxed" style={{ color: 'var(--v2-text-dim)' }}>
        <span className="font-medium" style={{ color: 'var(--v2-text)' }}>
          Sample wallet.
        </span>{' '}
        Every figure on this screen is synthetic, including the tax position. Add an explorer API key to
        read a real wallet.
      </p>
    </div>
  );
}

/* ---- Shell ----------------------------------------------------------- */

export default function PrototypeApp() {
  const [tab, setTab] = useState<TabId>('activity');
  const [chain, setChain] = useState<Chain | 'all'>('all');
  const [view, setView] = useState<View>('loaded');

  const runSearch = () => {
    setView('loading');
    window.setTimeout(() => setView('loaded'), 1100);
  };

  return (
    <div className="v2 flex min-h-[100dvh]">
      <Rail active={tab} onChange={setTab} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar chain={chain} onChain={setChain} onSearch={runSearch} />

        <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-7 sm:px-6">
          {view === 'empty' ? (
            <EmptyState onLoadDemo={runSearch} />
          ) : (
            <div className="flex flex-col gap-6">
              <WalletHeader />
              <DemoNotice />
              <TabBar active={tab} onChange={setTab} />

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div role="tabpanel" id={`v2-panel-${tab}`} aria-labelledby={`v2-tab-${tab}`}>
                  {view === 'loading' ? (
                    <ActivitySkeleton />
                  ) : tab === 'activity' ? (
                    <ActivityPanel />
                  ) : tab === 'taxes' ? (
                    <TaxPanel />
                  ) : tab === 'approvals' ? (
                    <ApprovalsPanel />
                  ) : (
                    <RiskPanel />
                  )}
                </div>

                <div className="flex flex-col gap-6">
                  <IntelligencePanel />
                  {tab !== 'risk' && <RiskPanel />}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
