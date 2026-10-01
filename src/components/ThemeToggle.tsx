// src/components/ThemeToggle.tsx
//
// Three states: light, dark, and following the operating system.
//
// Dark is the default: it is the brand's look, and index.html starts dark.
// Every explicit choice is stored, and a small script in index.html applies it
// before first paint, so a visitor who chose light never sees a dark flash.

import { useEffect, useState } from 'react';
import { MonitorIcon, MoonIcon, SunIcon } from '@phosphor-icons/react';

type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'chainstory-theme';

function readStored(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'system' ? value : 'dark';
  } catch {
    // Private windows and blocked storage both throw. Keep the default.
    return 'dark';
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
  const [theme, setTheme] = useState<Theme>(readStored);

  useEffect(() => {
    const stored = readStored();
    setTheme(stored);
    apply(stored);
  }, []);

  const choose = (next: Theme) => {
    setTheme(next);
    apply(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
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
