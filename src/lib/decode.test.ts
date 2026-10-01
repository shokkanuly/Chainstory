import { describe, expect, it } from 'vitest';
import { decodeFrame, glyphAt, HEX_GLYPHS, resolvedCount } from './decode';

const TEXT = 'Swapped 2.0 ETH for 3,400 USDC';

describe('decode', () => {
  it('ends on the exact text', () => {
    expect(decodeFrame(TEXT, 1)).toBe(TEXT);
    expect(decodeFrame(TEXT, 1.5)).toBe(TEXT);
  });

  it('keeps the length and every space at every progress', () => {
    for (const p of [0, 0.1, 0.33, 0.5, 0.9, 0.999]) {
      const frame = decodeFrame(TEXT, p);
      expect(frame).toHaveLength(TEXT.length);
      [...TEXT].forEach((ch, i) => {
        if (ch === ' ') expect(frame[i]).toBe(' ');
      });
    }
  });

  it('resolves left to right', () => {
    const half = decodeFrame(TEXT, 0.5, () => 0);
    const n = resolvedCount(TEXT.length, 0.5);
    expect(half.slice(0, n)).toBe(TEXT.slice(0, n));
    // Unresolved, non-space characters show a hex digit.
    [...half.slice(n)].forEach((ch, i) => {
      if (TEXT[n + i] !== ' ') expect(HEX_GLYPHS).toContain(ch);
    });
  });

  it('treats a bad progress as not started, never as a crash', () => {
    expect(resolvedCount(10, Number.NaN)).toBe(0);
    expect(resolvedCount(10, -1)).toBe(0);
    expect(glyphAt('', 3, 0.5, Math.random)).toBe('');
  });
});
