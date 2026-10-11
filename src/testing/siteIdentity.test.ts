import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');
const retiredName = new RegExp(['re', 'told'].join(''), 'i');

describe('Tripwire public site identity', () => {
  it('ships Tripwire metadata and local assets without the retired product', () => {
    const html = read('index.html');
    expect(html).toContain('<title>Tripwire');
    expect(html).not.toMatch(retiredName);
    expect(html).not.toMatch(/tax report|fonts\.googleapis/i);
    expect(html).toContain('property="og:image"');
    expect(read('public/favicon.svg')).toContain('Tripwire');
  });

  it('removes the retired products from the route entry graph', () => {
    const routes = read('src/AppRoutes.tsx');
    expect(routes).not.toMatch(/Workspace|PrototypeApp|CheckPage/);
    expect(routes).toContain('<NotFound />');
    for (const oldPath of ['/app', '/check', '/v2']) {
      expect(routes).toContain(`path="${oldPath}"`);
    }
    expect(routes).toContain('<Navigate');
  });

  it('offers one product and a useful operations entry from the shared shell', () => {
    for (const file of ['src/pages/Landing.tsx', 'src/components/Navbar.tsx', 'src/components/Footer.tsx', 'src/components/Logo.tsx']) {
      const source = read(file);
      expect(source).not.toMatch(retiredName);
      expect(source).not.toMatch(/wallet analys|tax report|href="\/check"|href="\/v2"/i);
    }
    expect(read('src/components/Navbar.tsx')).toContain('/tripwire/operations');
    expect(read('src/components/Footer.tsx')).toContain('/tripwire/operations');
  });
});
