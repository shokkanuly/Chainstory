import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ReceiptReference from './ReceiptReference';

const receipt = { href: 'https://sepolia.etherscan.io/tx/0x123', children: '0x123' };
describe('receipt provenance in an example report', () => {
  it('never offers a synthetic identifier as a real explorer transaction', () => {
    const html = renderToStaticMarkup(createElement(ReceiptReference, { ...receipt, synthetic: true }));
    expect(html).toContain('0x123');
    expect(html).toContain('example');
    expect(html).not.toContain('href=');
  });
  it('keeps the exact explorer reference for an imported non-synthetic report', () => {
    const html = renderToStaticMarkup(createElement(ReceiptReference, { ...receipt, synthetic: false }));
    expect(html).toContain(`href="${receipt.href}"`);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('· example');
  });
});
