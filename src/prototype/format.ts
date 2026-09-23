// src/prototype/format.ts
//
// Pure formatters. Kept out of the component file so that file only exports
// components, which keeps React Fast Refresh working.

export function truncate(address: string, lead = 6, tail = 4): string {
  if (!address) return '';
  return `${address.slice(0, lead)}\u2026${address.slice(-tail)}`;
}

export function usd(value: number, sign = false): string {
  const formatted = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (!sign) return `$${formatted}`;
  return `${value < 0 ? '-' : '+'}$${formatted}`;
}
