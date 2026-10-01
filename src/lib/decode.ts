// src/lib/decode.ts
//
// The frame maths behind DecodeText: text resolving from hex into English,
// left to right, which is the product's promise made visible (calldata in,
// a sentence out).
//
// Pure and DOM-free so it can be tested: given the target text and a
// progress 0..1, say which characters are still scrambled and what they
// show. The one guarantee that matters is at progress 1: every character is
// the real one. Motion is the exception; the true text is the resting state.

export const HEX_GLYPHS = '0123456789abcdef';

/** How many characters are resolved at a given progress. */
export function resolvedCount(length: number, progress: number): number {
  if (!(progress > 0)) return 0;
  if (progress >= 1) return length;
  return Math.floor(length * progress);
}

/**
 * The glyph a character shows at a given progress: itself once resolved,
 * a hex digit before that. Whitespace is never scrambled, so words keep
 * their shape and line breaks do not move.
 */
export function glyphAt(text: string, index: number, progress: number, random: () => number): string {
  const ch = text[index];
  if (ch === undefined) return '';
  if (index < resolvedCount(text.length, progress) || /\s/.test(ch)) return ch;
  return HEX_GLYPHS[Math.floor(random() * HEX_GLYPHS.length) % HEX_GLYPHS.length];
}

/** A whole frame as a string. Used by tests; the component writes per character. */
export function decodeFrame(text: string, progress: number, random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < text.length; i++) out += glyphAt(text, i, progress, random);
  return out;
}
