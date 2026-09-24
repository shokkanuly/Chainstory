// src/prototype/panels.tsx
//
// The four content surfaces behind the tab bar, plus the right rail.
// Each uses a different layout family on purpose: the activity feed is a
// date-grouped list, taxes is a bare figure grid with no card chrome, and
// approvals is a two-column exposure table.

import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  ArrowSquareOutIcon,
  ShieldWarningIcon,
  SealCheckIcon,
  WarningIcon,
  FileCsvIcon,
} from '@phosphor-icons/react';
import {
  ACTIVITY,
  ALLOWANCES,
  CATEGORY_LABEL,
  TAX_LINES,
  WALLET,
  type Activity,
} from './sampleData';
import { AddressAvatar, CategoryPill, ChainMark, Flag, PanelHead } from './primitives';
import { truncate, usd } from './format';
import { explorerTxUrl } from '../services/chains';

const DAY = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

function groupByDay(items: Activity[]) {
  const groups = new Map<string, Activity[]>();
  for (const item of items) {
    const key = DAY.format(item.date);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()];
}

/* ---- Activity -------------------------------------------------------- */

function ActivityRow({ item, index }: { item: Activity; index: number }) {
  const reduce = useReducedMotion();
  const out = item.direction === 'out';
  const Arrow = out ? ArrowUpRightIcon : ArrowDownLeftIcon;

  return (
    <motion.div
      // Entry stagger communicates feed ordering: newest resolves first.
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: Math.min(index * 0.035, 0.28), ease: [0.16, 1, 0.3, 1] }}
      className="v2-row-hover group flex gap-3 px-5 py-3.5"
    >
      <div
        className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border"
        style={{
          background: 'var(--v2-raised)',
          borderColor: 'var(--v2-line)',
          color: out ? 'var(--v2-text-dim)' : 'var(--v2-gain)',
        }}
      >
        <Arrow size={15} weight="bold" />
      </div>

      {/* Two lines that hold their shape at every width: story against value,
          then context against the secondary figure. The value column never
          competes with the story for horizontal room. */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-[13.5px] font-medium leading-snug">{item.story}</p>
          <span className="v2-num shrink-0 text-[13.5px] font-medium leading-snug">
            {item.usdValue === null ? (
              <span style={{ color: 'var(--v2-text-faint)' }}>no value</span>
            ) : (
              <span style={{ color: out ? 'var(--v2-text)' : 'var(--v2-gain)' }}>
                {out ? '-' : '+'}
                {usd(item.usdValue)}
              </span>
            )}
          </span>
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-3">
          <div
            className="flex min-w-0 items-center gap-2 text-[11.5px]"
            style={{ color: 'var(--v2-text-faint)' }}
          >
            <ChainMark chain={item.chain} size={13} />
            <span className="hidden sm:inline">
              <CategoryPill category={item.category} label={CATEGORY_LABEL[item.category]} />
            </span>
            <span className="truncate">{item.counterparty}</span>
            <span className="hidden sm:inline" style={{ color: 'var(--v2-line-strong)' }}>
              /
            </span>
            <span className="v2-num hidden sm:inline">{TIME.format(item.date)}</span>
            <a
              href={explorerTxUrl(item.hash, item.chain)}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              style={{ color: 'var(--v2-text-dim)' }}
              aria-label="Open transaction in block explorer"
            >
              <ArrowSquareOutIcon size={13} weight="bold" />
            </a>
          </div>

          <span
            className="v2-num shrink-0 text-[11.5px]"
            style={{ color: 'var(--v2-text-faint)' }}
          >
            {item.realizedUsd !== undefined ? (
              <span style={{ color: item.realizedUsd >= 0 ? 'var(--v2-gain)' : 'var(--v2-loss)' }}>
                {usd(item.realizedUsd, true)} realized
              </span>
            ) : item.assetAmount > 0 ? (
              `${item.assetAmount.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${item.assetSymbol}`
            ) : (
              item.assetSymbol
            )}
          </span>
        </div>

        {item.flagged && (
          <div className="mt-2">
            <Flag label={item.flagged.label} severity={item.flagged.severity} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function ActivityPanel() {
  const groups = groupByDay(ACTIVITY);
  let rendered = -1;

  return (
    <section className="v2-panel overflow-hidden">
      <PanelHead
        title="Activity"
        action={
          <span className="v2-num text-[11.5px]" style={{ color: 'var(--v2-text-faint)' }}>
            {ACTIVITY.length} of {WALLET.txCount}
          </span>
        }
      />
      {groups.map(([day, items]) => (
        <div key={day}>
          <div
            className="px-5 py-2 text-[11px] font-medium"
            style={{ background: 'var(--v2-canvas)', color: 'var(--v2-text-faint)' }}
          >
            {day}
          </div>
          {items.map((item) => {
            rendered += 1;
            return <ActivityRow key={item.hash} item={item} index={rendered} />;
          })}
        </div>
      ))}
    </section>
  );
}

/* ---- Taxes ----------------------------------------------------------- */

export function TaxPanel() {
  return (
    <section className="v2-panel overflow-hidden">
      <PanelHead
        title="Draft tax position, 2026"
        action={
          <button className="v2-btn v2-btn--ghost">
            <FileCsvIcon size={14} weight="bold" />
            Form 8949
          </button>
        }
      />

      {/* Figures breathe in plain layout. No nested card chrome. */}
      <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-3" style={{ background: 'var(--v2-line)' }}>
        {TAX_LINES.map((line) => (
          <div key={line.label} className="px-5 py-5" style={{ background: 'var(--v2-surface)' }}>
            <div className="text-[11.5px]" style={{ color: 'var(--v2-text-faint)' }}>
              {line.label}
            </div>
            <div
              className="v2-num mt-2 text-[22px] font-medium tracking-[-0.03em]"
              style={{
                color:
                  line.tone === 'gain'
                    ? 'var(--v2-gain)'
                    : line.tone === 'loss'
                      ? 'var(--v2-loss)'
                      : 'var(--v2-text)',
              }}
            >
              {line.value}
            </div>
            {line.note && (
              <div className="mt-1.5 text-[11.5px]" style={{ color: 'var(--v2-text-faint)' }}>
                {line.note}
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        className="flex items-start gap-2.5 px-5 py-3.5 text-[11.5px] leading-relaxed"
        style={{ background: 'var(--v2-canvas)', color: 'var(--v2-text-dim)' }}
      >
        <WarningIcon size={14} weight="bold" style={{ color: 'var(--v2-warn)', flexShrink: 0, marginTop: 1 }} />
        <p>
          Draft estimate over the last 100 transactions. Two disposals have no matching acquisition in
          this window, so the gain shown is an upper bound. Review with a qualified accountant.
        </p>
      </div>
    </section>
  );
}

/* ---- Approvals ------------------------------------------------------- */

export function ApprovalsPanel() {
  const totalAtRisk = ALLOWANCES.reduce((sum, a) => sum + (a.atRiskUsd ?? 0), 0);

  return (
    <section className="v2-panel overflow-hidden">
      <PanelHead
        title="Live allowances"
        action={
          <span className="v2-num text-[11.5px]" style={{ color: 'var(--v2-warn)' }}>
            {usd(totalAtRisk)} exposed
          </span>
        }
      />
      {ALLOWANCES.map((a) => (
        <div
          key={`${a.tokenAddress}-${a.spenderAddress}`}
          className="v2-row-hover flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <ChainMark chain={a.chain} size={14} />
              <span className="text-[13.5px] font-medium">{a.token}</span>
              <span className="text-[13.5px]" style={{ color: 'var(--v2-text-faint)' }}>
                to
              </span>
              <span className="text-[13.5px] font-medium">{a.spender}</span>
              {a.unlimited && <Flag label="Unlimited" severity="warn" />}
            </div>
            <div className="v2-hash mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
              <span>spender {truncate(a.spenderAddress)}</span>
              <span style={{ color: 'var(--v2-line-strong)' }}>/</span>
              <span>token {truncate(a.tokenAddress)}</span>
            </div>
          </div>
          <div className="shrink-0 text-left sm:text-right">
            <div className="v2-num text-[13.5px]">{a.amountText}</div>
            <div className="v2-num mt-1 text-[11.5px]" style={{ color: 'var(--v2-text-faint)' }}>
              {a.atRiskUsd !== null ? `${usd(a.atRiskUsd)} at risk` : 'unknown'}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

/* ---- Right rail ------------------------------------------------------ */

export function IntelligencePanel() {
  const stats = [
    { label: 'Wallet age', value: `${(WALLET.ageDays / 365).toFixed(1)} yr` },
    { label: 'Transactions', value: WALLET.txCount.toLocaleString('en-US') },
    { label: 'Protocols', value: String(WALLET.protocolCount) },
  ];

  return (
    <section className="v2-panel overflow-hidden">
      <PanelHead title="Wallet intelligence" />
      <div className="px-5 py-4">
        <div className="flex items-center gap-2">
          <SealCheckIcon size={15} weight="fill" style={{ color: 'var(--v2-accent)' }} />
          <span className="text-[13.5px] font-medium">{WALLET.reputation}</span>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--v2-text-dim)' }}>
          {WALLET.reputationNote}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-px border-t" style={{ background: 'var(--v2-line)' }}>
        {stats.map((s) => (
          <div key={s.label} className="px-4 py-3.5" style={{ background: 'var(--v2-surface)' }}>
            <div className="text-[11px]" style={{ color: 'var(--v2-text-faint)' }}>
              {s.label}
            </div>
            <div className="v2-num mt-1 text-[15px] font-medium">{s.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function RiskPanel() {
  const flagged = ACTIVITY.filter((a) => a.flagged);

  return (
    <section className="v2-panel overflow-hidden">
      <PanelHead
        title="Counterparty risk"
        action={
          <span className="v2-num text-[11.5px]" style={{ color: 'var(--v2-loss)' }}>
            {flagged.length} flagged
          </span>
        }
      />
      {flagged.map((item) => (
        <div key={item.hash} className="v2-row-hover flex items-start gap-3 px-5 py-4">
          <ShieldWarningIcon
            size={16}
            weight="bold"
            style={{
              color: item.flagged!.severity === 'danger' ? 'var(--v2-loss)' : 'var(--v2-warn)',
              flexShrink: 0,
              marginTop: 1,
            }}
          />
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium leading-snug">{item.counterparty}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed" style={{ color: 'var(--v2-text-dim)' }}>
              {item.flagged!.label}. Matched against a bundled list of known addresses, which is not a
              sanctions database.
            </p>
            <p className="v2-hash mt-1.5 text-[11px]">{truncate(item.counterpartyAddress, 10, 6)}</p>
          </div>
        </div>
      ))}
    </section>
  );
}

/* ---- Empty and loading states ---------------------------------------- */

export function ActivitySkeleton() {
  return (
    <section className="v2-panel overflow-hidden">
      <PanelHead title="Activity" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-3.5">
          <div className="v2-skel h-9 w-9" style={{ borderRadius: 10 }} />
          <div className="space-y-2">
            <div className="v2-skel h-3.5" style={{ width: `${68 - i * 7}%` }} />
            <div className="v2-skel h-2.5 w-32" />
          </div>
          <div className="space-y-2">
            <div className="v2-skel ml-auto h-3.5 w-20" />
            <div className="v2-skel ml-auto h-2.5 w-14" />
          </div>
        </div>
      ))}
    </section>
  );
}

export function EmptyState({ onLoadDemo }: { onLoadDemo: () => void }) {
  return (
    <section className="v2-panel flex flex-col items-center px-6 py-16 text-center">
      <AddressAvatar address="0x0000000000000000000000000000000000000000" size={44} />
      <h2 className="mt-5 text-[15px] font-semibold">No wallet loaded</h2>
      <p className="mt-2 max-w-[38ch] text-[12.5px] leading-relaxed" style={{ color: 'var(--v2-text-dim)' }}>
        Paste any address or ENS name above to read its history in plain English. No wallet connection,
        no signature.
      </p>
      <button className="v2-btn v2-btn--primary mt-6" onClick={onLoadDemo}>
        Load a sample wallet
      </button>
    </section>
  );
}
