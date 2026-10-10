// H1 browser smoke for "Follow public report folder" on /tripwire/operations.
// Real Chromium, real FileSystemDirectoryHandle (the origin-private file
// system): everything after the native picker runs for real. The dialog itself
// is replaced, because automation cannot drive it; a human still closes that part.
// Synthetic fixtures only. Playwright is not a project dependency:
//   npm run build && npx vite preview --port 4173 --strictPort &
//   NODE_PATH="$(npm root -g)" node scripts/smoke/operationsFolder.mjs [http://127.0.0.1:4173] [screenshot-dir]
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const SHOTS = process.argv[3] ?? '.tripwire/browser-smoke';
mkdirSync(SHOTS, { recursive: true });
const fixture = (name) => readFileSync(join('src/testing/fixtures/tripwire', name), 'utf8');
const healthy = fixture('operations-worker-synthetic.json'), outage = fixture('operations-worker-outage-synthetic.json');
const file = (n) => `observation-${1000 + n}-00000000-0000-0000-0000-${String(n + 1).padStart(12, '0')}.json`;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The picker returns a real directory handle in the origin-private file system.
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('public-reports', { create: true });
  });
  await page.goto(`${BASE}/tripwire/operations`);
  const put = (name, text) => page.evaluate(async ([n, t]) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('public-reports', { create: true });
    const writable = await (await dir.getFileHandle(n, { create: true })).createWritable(); await writable.write(t); await writable.close();
  }, [name, text]);
  const remove = (name) => page.evaluate(async (n) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('public-reports', { create: true }); await dir.removeEntry(n);
  }, name);
  const text = () => page.locator('main').innerText();
  const until = async (predicate, ms = 12_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (predicate(await text())) return true; await page.waitForTimeout(250); }
    return false;
  };
  // Payment cards: one "To 0x…" line each.
  const rows = async () => ((await text()).match(/^To 0x/gm) ?? []).length;

  const button = page.getByRole('button', { name: 'Follow public report folder' });
  check('folder button enabled in a secure context with the API', await button.isEnabled());
  await put(file(0), healthy);
  await button.click();
  check('first healthy report shows its four synthetic payments', await until((t) => /Following public reports/.test(t) && /HELD/i.test(t))
    && await rows() === 4, `${await rows()} payment cards`);
  check('original capture time is shown', /2026|07:00/.test(await text()));
  await page.screenshot({ path: join(SHOTS, '1-healthy-desktop-synthetic.png'), fullPage: true });

  await put(file(1), outage);
  check('newer outage replaces every payment row (no stale data)', await until((t) => /unavailable|outage/i.test(t) && !/HELD/.test(t))
    && await rows() === 0);
  await page.screenshot({ path: join(SHOTS, '2-outage-synthetic.png'), fullPage: true });

  await put(file(2), healthy);
  check('a newer healthy report brings the rows back', await until((t) => /HELD/.test(t)) && await rows() === 4);

  await put(file(3), '{"version": 1, "corrupted": ');
  check('corrupted newest report is refused without an older substitute',
    await until((t) => /newest report is invalid/i.test(t) && !/HELD/.test(t)));

  await remove(file(3));
  check('deleting the newest report does not fall back to an older one',
    await until((t) => /disappeared or publication order changed/i.test(t) && !/HELD/.test(t)));

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('390px layout has no horizontal page scroll', overflow <= 1, `overflow ${overflow}px`);
  await page.screenshot({ path: join(SHOTS, '3-refused-390px-synthetic.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.getByRole('button', { name: 'Disconnect folder' }).click();
  check('Disconnect stops following', await until((t) => !/Following public reports/.test(t), 3_000));
  await page.reload();
  check('reload starts without a remembered folder', !/Following public reports/.test(await text()));

  const plain = await (await browser.newContext()).newPage();
  await plain.addInitScript(() => { delete window.showDirectoryPicker; });
  await plain.goto(`${BASE}/tripwire/operations`);
  check('browser without the API: folder button disabled, import still available',
    await plain.getByRole('button', { name: 'Follow public report folder' }).isDisabled());
  check('no uncaught page errors', errors.length === 0, errors.join(' | '));
} finally { await browser.close(); }
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed. Screenshots (synthetic): ${SHOTS}`);
process.exitCode = failed ? 1 : 0;
