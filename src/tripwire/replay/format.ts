// Display formatting for the replay. Pure, so the numbers on screen are tested.

const trim = (s: string) => s.replace(/\.0+$|(\.\d*?)0+$/, '$1');

/** $292M, $11.58M, $81.7K, $940. */
export function usd(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}$${trim((a / 1e9).toFixed(2))}B`;
  if (a >= 1e6) return `${sign}$${trim((a / 1e6).toFixed(a >= 1e8 ? 0 : 2))}M`;
  if (a >= 1e3) return `${sign}$${trim((a / 1e3).toFixed(1))}K`;
  return `${sign}$${Math.round(a)}`;
}

/** Replay seconds as T+mm:ss, or T+h:mm:ss past an hour. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `T+${h}:${String(m).padStart(2, '0')}:${ss}` : `T+${String(m).padStart(2, '0')}:${ss}`;
}

/** 2026-04-18 -> 18 Apr 2026, independent of the viewer's timezone. */
export function reportDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}
