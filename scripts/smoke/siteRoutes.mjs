// Every site route in real Chromium at desktop and phone widths: it renders a
// heading, raises no uncaught error or console error, and has no horizontal
// page scroll. Outbound network is blocked so the run is offline and repeatable;
// pages that fetch live data must degrade without a crash. Playwright is a
// global tool here, not a project dependency:
//   npm run build && npx vite preview --port 4173 --strictPort &
//   NODE_PATH="$(npm root -g)" node scripts/smoke/siteRoutes.mjs [http://127.0.0.1:4173]
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const ROUTES = ['/', '/app', '/tripwire', '/tripwire?incident=kelp', '/tripwire?incident=verus', '/tripwire?incident=syscoin',
  '/tripwire/operations', '/check', '/v2', '/no-such-page'];
const SIZES = [{ width: 1280, height: 900 }, { width: 390, height: 844 }];
const origin = new URL(BASE).origin;
let failed = 0;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const viewport of SIZES) {
    for (const route of ROUTES) {
      const context = await browser.newContext({ viewport });
      // Offline: same-origin only. Fonts/RPC/explorer calls fail fast and must not crash a page.
      await context.route('**/*', (r) => (r.request().url().startsWith(origin) ? r.continue() : r.abort()));
      const page = await context.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));
      page.on('console', (m) => {
        // Blocked third-party requests are expected offline; anything else is a defect.
        if (m.type() === 'error' && !/net::ERR_FAILED|Failed to load resource|ERR_BLOCKED/i.test(m.text())) problems.push(`console: ${m.text().slice(0, 160)}`);
      });
      const response = await page.goto(`${BASE}${route}`, { waitUntil: 'load' });
      await page.waitForTimeout(1500);
      const heading = await page.locator('h1, h2').first().innerText().catch(() => '');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (!response?.ok()) problems.push(`HTTP ${response?.status()}`);
      if (!heading.trim()) problems.push('no heading rendered');
      if (overflow > 1) problems.push(`horizontal overflow ${overflow}px`);
      const ok = problems.length === 0;
      if (!ok) failed++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(viewport.width).padStart(4)}px  ${route.padEnd(26)} ${ok ? heading.split('\n')[0].slice(0, 60) : problems.join(' | ')}`);
      await context.close();
    }
  }
} finally { await browser.close(); }
console.log(`${SIZES.length * ROUTES.length - failed}/${SIZES.length * ROUTES.length} route checks passed.`);
process.exitCode = failed ? 1 : 0;
