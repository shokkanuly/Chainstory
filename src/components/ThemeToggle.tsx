// src/components/ThemeToggle.tsx
//
// Three states, not two: light, dark, and following the operating system.
//
// A two-state toggle has to pick a starting side, which means someone whose
// machine is set to dark gets a flash of white on first load. Defaulting to
// "system" and only writing an override when the visitor actually chooses one
// avoids that, and respects a setting they already made.

import { useEffect, useState } from 'react';
import { MonitorIcon, MoonIcon, SunIcon } from '@phosphor-icons/react';

type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'tripwire-theme';

function readStored(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    // Private windows and blocked storage both throw. Follow the OS instead.
    return 'system';
  }
}

function apply(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

const OPTIONS: { value: Theme; label: string; icon: typeof SunIcon }[] = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon },
];

export default function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const stored = readStored();
    setTheme(stored);
    apply(stored);
  }, []);

  const choose = (next: Theme) => {
    setTheme(next);
    apply(next);
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still applies for this session.
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={`inline-flex items-center gap-0.5 rounded-full border p-0.5 ${className ?? ''}`}
      style={{ borderColor: 'var(--b-line)', background: 'var(--b-surface)' }}
    >
      {OPTIONS.map((opt) => {
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => choose(opt.value)}
            className="grid h-7 w-7 place-items-center rounded-full transition-colors"
            style={{
              background: active ? 'var(--b-canvas)' : 'transparent',
              color: active ? 'var(--b-text)' : 'var(--b-text-faint)',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <opt.icon size={14} weight={active ? 'fill' : 'regular'} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
