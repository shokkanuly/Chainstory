// docs/social/posters.mjs — the launch posters for X, Instagram and Threads.
//
//   node docs/social/posters.mjs
//
// Writes docs/social/posters/<name>-x.png (1600×900, X) and <name>-4x5.png
// (1080×1350, Instagram feed and Threads). Change SITE below and re-run when
// the domain changes; nothing else needs touching. Needs Playwright with a
// Chromium (`npm i -D playwright && npx playwright install chromium`, or any
// global install).
//
// Same look as the site: the silk backdrop (components/AmbientBackground.tsx),
// the brand's fonts and mark, and the site's status colours. Every claim is one
// the README backs; the swap example is marked illustrative, as on the site.

import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

// --- the only line you normally edit -------------------------------------------
const SITE = 'chainstory-iota.vercel.app';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const OUT = join(here, 'posters');

const font = (pkg, file) =>
  readFileSync(join(root, 'node_modules/@fontsource', pkg, 'files', file)).toString('base64');
const FONTS = `
@font-face { font-family: 'Space Grotesk'; font-weight: 500; src: url(data:font/woff2;base64,${font('space-grotesk', 'space-grotesk-latin-500-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'Space Grotesk'; font-weight: 600; src: url(data:font/woff2;base64,${font('space-grotesk', 'space-grotesk-latin-600-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'Space Grotesk'; font-weight: 700; src: url(data:font/woff2;base64,${font('space-grotesk', 'space-grotesk-latin-700-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'DM Mono'; font-weight: 400; src: url(data:font/woff2;base64,${font('dm-mono', 'dm-mono-latin-400-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'DM Mono'; font-weight: 500; src: url(data:font/woff2;base64,${font('dm-mono', 'dm-mono-latin-500-normal.woff2')}) format('woff2'); }`;

const MARK = `<svg class="mark" viewBox="0 0 667 534" aria-hidden="true"><defs><linearGradient id="bar" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#6e6afa"/><stop offset="0.45" stop-color="#8b5cf6"/><stop offset="1" stop-color="#5598de"/></linearGradient></defs>
<g fill="url(#bar)"><polygon points="300,66.8 667,0 667,127.3 300,194.1"/><polygon points="0,236.8 667,170.1 667,297.4 0,364.1"/><polygon points="0,406.9 500,340.2 500,467.5 0,534.2"/></g></svg>`;

// The site's silk backdrop, dark tuning (styles/ambient.css).
const SILK = `<svg class="silk" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>
<linearGradient id="a" x1="0" y1="0" x2="1" y2="0.4"><stop offset="0" stop-color="#3b5bff"/><stop offset="0.55" stop-color="#8b3dff"/><stop offset="1" stop-color="#e0439a"/></linearGradient>
<linearGradient id="b" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#f08a6b"/><stop offset="0.45" stop-color="#e0439a"/><stop offset="1" stop-color="#8b3dff"/></linearGradient>
<linearGradient id="c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b3dff"/><stop offset="1" stop-color="#3b5bff"/></linearGradient>
<filter id="g" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="38"/></filter>
<filter id="s" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="6"/></filter></defs>
<g filter="url(#g)" opacity="0.62">
<path d="M-120 210 C 220 60, 520 380, 860 250 S 1380 40, 1580 170 L 1580 330 C 1320 240, 1080 470, 780 430 S 180 260, -120 420 Z" fill="url(#a)"/>
<path d="M-80 760 C 260 520, 560 640, 880 560 S 1300 360, 1540 460 L 1540 600 C 1260 560, 1020 760, 720 780 S 160 700, -80 900 Z" fill="url(#b)"/></g>
<g filter="url(#s)" opacity="0.55">
<path d="M-100 300 C 240 150, 560 430, 900 300 S 1360 110, 1560 230 L 1560 262 C 1350 160, 1120 390, 890 350 S 260 230, -100 350 Z" fill="url(#a)"/>
<path d="M-60 690 C 300 520, 600 640, 900 590 S 1320 430, 1520 510 L 1520 540 C 1300 470, 1060 650, 880 640 S 280 590, -60 740 Z" fill="url(#b)"/>
<path d="M420 -40 C 560 160, 640 360, 980 520 S 1340 760, 1480 940 L 1440 960 C 1300 800, 1100 640, 940 560 S 520 220, 380 -40 Z" fill="url(#c)"/></g></svg>`;

const CSS = `${FONTS}
* { box-sizing: border-box; margin: 0; }
html, body { width: 100%; height: 100%; }
body { background: #0d0d12; color: #f5f2eb; font-family: 'Space Grotesk', sans-serif; -webkit-font-smoothing: antialiased; }
.poster { position: relative; width: 100%; height: 100%; overflow: hidden; }
.silk { position: absolute; inset: -4%; width: 108%; height: 108%; }
.veil { position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(13,13,18,.28), rgba(13,13,18,.72)); }
.content { position: relative; height: 100%; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: .55em; font-weight: 600; letter-spacing: -.02em; }
.mark { height: .95em; width: auto; }
.pill { font-family: 'DM Mono', monospace; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; border: 1px solid rgba(166,100,252,.5); color: #c9a6ff; border-radius: 999px; }
.label { font-family: 'DM Mono', monospace; letter-spacing: .16em; text-transform: uppercase; color: #9b9bab; }
h1 { font-weight: 700; letter-spacing: -.045em; line-height: .98; }
h1 .accent { background: linear-gradient(100deg, #a664fc 0%, #8b5cf6 45%, #6f9bff 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sub { color: #c9c6d3; line-height: 1.38; }
.card { background: rgba(22,22,29,.82); border: 1px solid #2e2e38; border-radius: 22px; backdrop-filter: blur(6px); }
.mono { font-family: 'DM Mono', monospace; }
.foot { display: flex; align-items: center; justify-content: space-between; margin-top: auto; }
.url { font-weight: 600; letter-spacing: -.01em; }
.fine { color: #9b9bab; font-family: 'DM Mono', monospace; letter-spacing: .04em; }
.dot { display: inline-block; width: .62em; height: .62em; border-radius: 50%; margin-right: .5em; vertical-align: .05em; }
.clear { color: #1fa58f; } .elevated { color: #d9a43a; } .trip { color: #e2507a; } .none { color: #9b9bab; }
.bg-clear { background: #1fa58f; } .bg-elevated { background: #d9a43a; } .bg-trip { background: #e2507a; } .bg-none { background: #6c6c7a; }
`;

const page = (body, cls) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body><div class="poster ${cls}">${SILK}<div class="veil"></div><div class="content">${body}</div></div></body></html>`;

const foot = (fine) => `<div class="foot"><div><div class="url">${SITE}</div><div class="fine">${fine}</div></div></div>`;

// --- 1. Tripwire: the four tiers, live on Sepolia ---------------------------------
const TIERS = [
  ['none', '0.00', 'NONE', 'Ordinary payout, backed by a burn', 'paid'],
  ['elevated', '0.65', 'THROTTLE', 'Payout to a brand-new, unverified, upgradeable contract', 'cap halved'],
  ['elevated', '0.85', 'DELAY', 'A 10× burst to the same contract', 'held 30 min'],
  ['trip', '1.00', 'FREEZE', 'Forged payout, no burn behind it', 'blocked'],
];
const tierRows = (size) =>
  TIERS.map(
    ([tone, score, tier, what, effect]) => `
  <div class="tier" style="display:grid;grid-template-columns:${size.score}px ${size.tier}px 1fr;align-items:center;gap:${size.gap}px;padding:${size.pad}px 0;border-top:1px solid #2e2e38">
    <span class="mono" style="font-size:${size.fs}px;color:#9b9bab">${score}</span>
    <span class="mono ${tone === 'none' ? 'none' : tone}" style="font-size:${size.fs}px;font-weight:500;letter-spacing:.08em"><span class="dot bg-${tone}"></span>${tier}</span>
    <span style="font-size:${size.fs}px;line-height:1.3">${what} <span style="color:#9b9bab">— ${effect}</span></span>
  </div>`
  ).join('');

const tripwire = {
  x: page(
    `<div style="padding:84px 96px;height:100%;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:22px"><div class="brand" style="font-size:40px">${MARK}Tripwire</div><span class="pill" style="font-size:15px;padding:7px 14px">Live on Sepolia</span></div>
      <div style="display:grid;grid-template-columns:1fr 760px;gap:64px;margin-top:70px;align-items:start">
        <div>
          <h1 style="font-size:96px">A circuit breaker<br><span class="accent">for bridges.</span></h1>
          <p class="sub" style="font-size:27px;margin-top:34px;max-width:620px">$292M left Kelp DAO’s bridge in a single release. Tripwire scores each payout <b>before</b> it executes, and tightens just that route.</p>
        </div>
        <div class="card" style="padding:30px 34px 14px">
          <div class="label" style="font-size:14px;margin-bottom:14px">Score → guardian tier · run on Sepolia</div>
          ${tierRows({ score: 64, tier: 190, gap: 18, pad: 17, fs: 21 })}
        </div>
      </div>
      ${foot('Open source · MIT · contracts verified on Sepolia Etherscan')}
    </div>`,
    'x'
  ),
  '4x5': page(
    `<div style="padding:86px 80px;height:100%;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:20px"><div class="brand" style="font-size:40px">${MARK}Tripwire</div><span class="pill" style="font-size:15px;padding:7px 14px">Live on Sepolia</span></div>
      <h1 style="font-size:104px;margin-top:84px">A circuit<br>breaker<br><span class="accent">for bridges.</span></h1>
      <p class="sub" style="font-size:30px;margin-top:34px">$292M left Kelp DAO’s bridge in a single release. Tripwire scores each payout <b>before</b> it executes, and tightens just that route.</p>
      <div class="card" style="padding:28px 32px 12px;margin-top:48px">
        <div class="label" style="font-size:14px;margin-bottom:12px">Score → guardian tier · run on Sepolia</div>
        ${tierRows({ score: 58, tier: 168, gap: 14, pad: 15, fs: 20 })}
      </div>
      ${foot('Open source · MIT · verified on Sepolia Etherscan')}
    </div>`,
    'p'
  ),
};

// --- 2. Check before you sign: green vs red --------------------------------------
const verdict = (tone, badge, title, reasons, fs) => `
  <div class="card" style="padding:${fs * 1.4}px ${fs * 1.5}px;border-color:${tone === 'clear' ? 'rgba(31,165,143,.55)' : 'rgba(226,80,122,.6)'}">
    <div class="${tone}" style="font-size:${fs * 0.82}px;font-weight:600"><span class="dot bg-${tone}"></span>${badge}</div>
    <div style="font-size:${fs * 1.12}px;font-weight:600;letter-spacing:-.02em;margin-top:${fs * 0.7}px;line-height:1.2">${title}</div>
    <div style="margin-top:${fs * 0.6}px;display:grid;gap:${fs * 0.35}px">${reasons
      .map((r) => `<div style="font-size:${fs * 0.78}px;color:#c9c6d3;line-height:1.35">${r}</div>`)
      .join('')}</div>
  </div>`;
const GREEN = ['Green · No risk signals found', 'Send 250 tokens to another wallet', ['Plain ERC-20 transfer, decoded from the calldata']];
const RED = [
  "Red · Don't sign unless you are certain",
  'Unlimited approval to a day-old, unverified contract',
  ['Unlimited allowance', "Spender's source isn't verified", 'Spender deployed 1 day ago'],
];
const check = {
  x: page(
    `<div style="padding:84px 96px;height:100%;display:flex;flex-direction:column">
      <div class="brand" style="font-size:40px">${MARK}Retold</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:64px;margin-top:64px;align-items:center">
        <div>
          <div class="label" style="font-size:16px">Check before you sign</div>
          <h1 style="font-size:92px;margin-top:20px">Know what<br><span class="accent">you're signing.</span></h1>
          <p class="sub" style="font-size:27px;margin-top:30px">Paste a pending transaction. Get green, yellow or red, with the reasons. Nothing to connect, nothing to sign.</p>
        </div>
        <div style="display:grid;gap:22px">${verdict('clear', ...GREEN, 27)}${verdict('trip', ...RED, 27)}</div>
      </div>
      ${foot('Free · read-only · open source')}
    </div>`,
    'x'
  ),
  '4x5': page(
    `<div style="padding:86px 80px;height:100%;display:flex;flex-direction:column">
      <div class="brand" style="font-size:40px">${MARK}Retold</div>
      <div class="label" style="font-size:16px;margin-top:70px">Check before you sign</div>
      <h1 style="font-size:100px;margin-top:18px">Know what<br><span class="accent">you're signing.</span></h1>
      <p class="sub" style="font-size:29px;margin-top:28px">Paste a pending transaction. Get green, yellow or red, with the reasons.</p>
      <div style="display:grid;gap:22px;margin-top:44px">${verdict('clear', ...GREEN, 28)}${verdict('trip', ...RED, 28)}</div>
      ${foot('Nothing to connect · nothing to sign')}
    </div>`,
    'p'
  ),
};

// --- 3. Retold: onchain, understood ------------------------------------------------
const translate = (fs) => `
  <div class="card" style="padding:${fs * 1.3}px ${fs * 1.4}px">
    <div class="label" style="font-size:${fs * 0.5}px">What a block explorer shows</div>
    <div class="mono" style="font-size:${fs * 0.68}px;color:#9b9bab;margin-top:${fs * 0.45}px;line-height:1.5">swapExactETHForTokens<br>value 2000000000000000000 wei</div>
    <div style="height:1px;background:#2e2e38;margin:${fs * 0.8}px 0"></div>
    <div class="label" style="font-size:${fs * 0.5}px;color:#c9a6ff">What Retold shows · illustrative</div>
    <div style="font-size:${fs * 1.05}px;font-weight:600;letter-spacing:-.02em;margin-top:${fs * 0.4}px">Swapped 2.0 ETH for 3,400 USDC</div>
  </div>`;
const CHIPS = ['Plain-English history', 'Draft Form 8949', 'Approval audit', 'Check before you sign'];
const chips = (fs) =>
  `<div style="display:flex;flex-wrap:wrap;gap:${fs * 0.5}px">${CHIPS.map(
    (c) => `<span style="font-size:${fs}px;border:1px solid #3a3a46;border-radius:999px;padding:${fs * 0.45}px ${fs * 0.9}px;color:#dcd9e4;background:rgba(22,22,29,.6)">${c}</span>`
  ).join('')}</div>`;
const retold = {
  x: page(
    `<div style="padding:84px 96px;height:100%;display:flex;flex-direction:column">
      <div class="brand" style="font-size:40px">${MARK}Retold</div>
      <div style="display:grid;grid-template-columns:1fr 720px;gap:64px;margin-top:64px;align-items:center">
        <div>
          <h1 style="font-size:112px">Onchain,<br><span class="accent">understood.</span></h1>
          <p class="sub" style="font-size:27px;margin-top:30px">Paste any wallet. Read its history in plain English. No wallet connection.</p>
        </div>
        ${translate(34)}
      </div>
      <div style="margin-top:44px">${chips(20)}</div>
      ${foot('Ethereum · Arbitrum · Base · Optimism · Polygon · open source')}
    </div>`,
    'x'
  ),
  '4x5': page(
    `<div style="padding:86px 80px;height:100%;display:flex;flex-direction:column">
      <div class="brand" style="font-size:40px">${MARK}Retold</div>
      <h1 style="font-size:124px;margin-top:84px">Onchain,<br><span class="accent">understood.</span></h1>
      <p class="sub" style="font-size:30px;margin-top:30px">Paste any wallet. Read its history in plain English. No wallet connection.</p>
      <div style="margin-top:46px">${translate(34)}</div>
      <div style="margin-top:34px">${chips(21)}</div>
      ${foot('5 EVM chains · read-only · open source')}
    </div>`,
    'p'
  ),
};

// --- render -------------------------------------------------------------------------
async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const global = execSync('npm root -g').toString().trim();
    return createRequire(join(global, 'noop.js'))('playwright');
  }
}

const SIZES = { x: { width: 1600, height: 900 }, '4x5': { width: 1080, height: 1350 } };
const POSTERS = { tripwire, check, retold };

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
for (const [name, formats] of Object.entries(POSTERS)) {
  for (const [format, html] of Object.entries(formats)) {
    const p = await browser.newPage({ viewport: SIZES[format], deviceScaleFactor: 1 });
    await p.setContent(html, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    const file = join(OUT, `${name}-${format}.png`);
    await p.screenshot({ path: file });
    await p.close();
    console.log(`wrote ${file.replace(root + '/', '')}`);
  }
}
await browser.close();
