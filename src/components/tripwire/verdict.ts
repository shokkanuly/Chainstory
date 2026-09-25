// Verdict presentation, shared by the chart and the dashboard. Colours are the
// validated tokens in tripwire.css; a verdict is never shown by colour alone.
import type { Verdict } from '@/tripwire/types';

export const VERDICT_COLOR: Record<Verdict, string> = {
  clear: 'var(--tw-clear)',
  elevated: 'var(--tw-elevated)',
  trip: 'var(--tw-trip)',
  indeterminate: 'var(--b-text-faint)',
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  clear: 'Clear',
  elevated: 'Elevated',
  trip: 'Trip',
  indeterminate: 'Cannot assess',
};
