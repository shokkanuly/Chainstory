// src/prototype/primitives.tsx
//
// Small shared pieces for the v2 shell.

import type { ReactNode } from 'react';
import type { Category, Chain } from './sampleData';
import { CHAINS } from './sampleData';

const CATEGORY_VAR: Record<Category, string> = {
  trade: '--v2-cat-trade',
  income: '--v2-cat-income',
  transfer: '--v2-cat-transfer',
  nft: '--v2-cat-nft',
  approve: '--v2-cat-approve',
};

/**
 * Deterministic identity mark derived from the address, the way wallets do it.
 * Two hues pulled from the address bytes, so the same wallet always renders the
 * same gradient and users can recognise it at a glance.
 */
export function AddressAvatar({ address, size = 40 }: { address: string; size?: number }) {
  const clean = address.replace(/^0x/, '');
  const h1 = parseInt(clean.slice(0, 4), 16) % 360;
  const h2 = (parseInt(clean.slice(4, 8), 16) % 360);
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        background: `radial-gradient(circle at 30% 20%, hsl(${h1} 72% 62%), hsl(${h2} 65% 38%) 70%)`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)',
        flexShrink: 0,
      }}
    />
  );
}

export function ChainMark({ chain, size = 16 }: { chain: Chain; size?: number }) {
  const meta = CHAINS.find((c) => c.id === chain);
  if (!meta) return null;
  return (
    <img
      src={meta.icon}
      alt={meta.label}
      width={size}
      height={size}
      loading="lazy"
      style={{ borderRadius: '50%', flexShrink: 0 }}
    />
  );
}

export function CategoryPill({ category, label }: { category: Category; label: string }) {
  const color = `var(${CATEGORY_VAR[category]})`;
  return (
    <span
      className="v2-pill"
      style={{
        color,
        background: 'color-mix(in srgb, currentColor 10%, transparent)',
        borderColor: 'color-mix(in srgb, currentColor 22%, transparent)',
      }}
    >
      {label}
    </span>
  );
}

export function Flag({ label, severity }: { label: string; severity: 'warn' | 'danger' }) {
  const color = severity === 'danger' ? 'var(--v2-loss)' : 'var(--v2-warn)';
  return (
    <span
      className="v2-pill"
      style={{
        color,
        background: 'color-mix(in srgb, currentColor 10%, transparent)',
        borderColor: 'color-mix(in srgb, currentColor 26%, transparent)',
      }}
    >
      {label}
    </span>
  );
}

/** Section heading. No eyebrow, no floating right-hand paragraph. */
export function PanelHead({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-[var(--v2-line)]">
      <h2 className="text-[13px] font-semibold tracking-[-0.01em]">{title}</h2>
      {action}
    </div>
  );
}
