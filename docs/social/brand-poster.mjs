// docs/social/brand-poster.mjs — one poster for both products, black and white,
// in the sizes the main networks use.
//
//   node docs/social/brand-poster.mjs
//
// Writes docs/social/brand/retold-<theme>-<format>.png:
//
//   4x5    1080×1350  Instagram feed, Threads, Facebook, LinkedIn   (the main one)
//   1x1    1080×1080  square fallback: LinkedIn, Facebook, Telegram, Discord
//   16x9   1600×900   X / Twitter, LinkedIn link posts, YouTube community
//   9x16   1080×1920  Stories, Reels, TikTok, Shorts (content kept inside the safe zone)
//
// The background is the site's own silk shader: its GLSL is read straight out of
// src/components/motion/ShaderField.tsx and rendered here with WebGL, so the
// poster and the hero are the same light. Needs Playwright with a Chromium
// (any global install works). Change SITE when the domain changes.
//
// Every claim matches the site: the swap is marked illustrative, and the
// Tripwire figures are the Kelp DAO replay's (reported loss vs. before execution).

import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

// --- the only line you normally edit -------------------------------------------
const SITE = 'chainstory-iota.vercel.app';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const OUT = join(here, 'brand');

// --- the shader, from the site's source ------------------------------------------
const shaderSource = readFileSync(join(root, 'src/components/motion/ShaderField.tsx'), 'utf8');
const glsl = (name) => {
  const m = shaderSource.match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`;'));
  if (!m) throw new Error(`${name} not found in ShaderField.tsx`);
  return m[1];
};
const VERT = glsl('VERT');
const FRAG = glsl('FRAG');

// --- fonts, embedded so the render never depends on the network ------------------
const b64 = (path) => readFileSync(join(root, 'node_modules', path)).toString('base64');
const FONTS = `
@font-face { font-family: 'Geist'; font-weight: 100 900; src: url(data:font/woff2;base64,${b64('@fontsource-variable/geist/files/geist-latin-wght-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'Geist Mono'; font-weight: 100 900; src: url(data:font/woff2;base64,${b64('@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'Space Grotesk'; font-weight: 500; src: url(data:font/woff2;base64,${b64('@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'Space Grotesk'; font-weight: 600; src: url(data:font/woff2;base64,${b64('@fontsource/space-grotesk/files/space-grotesk-latin-600-normal.woff2')}) format('woff2'); }`;

const MARK = `<svg class="mark" viewBox="0 0 667 534" aria-hidden="true"><defs><linearGradient id="bar" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#6e6afa"/><stop offset="0.45" stop-color="#8b5cf6"/><stop offset="1" stop-color="#5598de"/></linearGradient></defs>
<g fill="url(#bar)"><polygon points="300,66.8 667,0 667,127.3 300,194.1"/><polygon points="0,236.8 667,170.1 667,297.4 0,364.1"/><polygon points="0,406.9 500,340.2 500,467.5 0,534.2"/></g></svg>`;

// --- the two themes: the site's tokens (styles/brand.css, styles/motion.css) ------
const THEMES = {
  dark: {
    bg: '#0d0d12', text: '#f5f2eb', muted: '#a9a9b8', faint: '#8a8a9a', line: '#2e2e38', lineStrong: '#3a3a46',
    card: 'rgba(22,22,29,.82)', chip: 'rgba(22,22,29,.55)', purple: '#a664fc', cyan: '#59edf7', red: '#ed615a',
    shadow: '0 40px 120px -40px rgba(166,100,252,.45)',
    fx: { dark: 1, c1: '#3b5bff', c2: '#8b3dff', c3: '#e0439a', c4: '#f08a6b', intensity: 1 },
  },
  light: {
    bg: '#ffffff', text: '#111114', muted: '#5b6270', faint: '#6b7280', line: '#e7e7ea', lineStrong: '#d4d4d8',
    card: 'rgba(255,255,255,.86)', chip: 'rgba(255,255,255,.75)', purple: '#8b47f5', cyan: '#0e7490', red: '#d63d3d',
    shadow: '0 40px 100px -40px rgba(91,60,200,.35)',
    fx: { dark: 0, c1: '#7c9cff', c2: '#b69cff', c3: '#f5a3cf', c4: '#ffc9a8', intensity: 1.15 },
  },
};

const css = (t) => `${FONTS}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; }
body { background: ${t.bg}; color: ${t.text}; font-family: 'Geist', sans-serif; -webkit-font-smoothing: antialiased; }
.poster { position: relative; width: 100%; height: 100%; overflow: hidden; }
#fx { position: absolute; inset: 0; width: 100%; height: 100%;
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 var(--fx-hold, 42%), transparent var(--fx-end, 88%));
          mask-image: linear-gradient(to bottom, #000 0%, #000 var(--fx-hold, 42%), transparent var(--fx-end, 88%)); }
.veil { position: absolute; inset: 0;
  background: radial-gradient(ellipse 75% 55% at 22% var(--veil-y, 30%), ${t.bg}c8, transparent 70%); }
.grid { position: absolute; inset: 0;
  background-image: linear-gradient(${t.text}0a 1px, transparent 1px), linear-gradient(90deg, ${t.text}0a 1px, transparent 1px);
  background-size: 56px 56px;
  -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 75%);
          mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 75%); }
.content { position: relative; height: 100%; display: flex; flex-direction: column; }
.top { display: flex; align-items: center; justify-content: space-between; }
.brand { display: flex; align-items: center; gap: .5em; font-weight: 600; letter-spacing: -.02em; }
.brand .and { color: ${t.muted}; font-weight: 500; }
.mark { height: .9em; width: auto; }
.pill { font-family: 'Geist Mono', monospace; font-weight: 500; letter-spacing: .1em; text-transform: uppercase;
  border: 1px solid ${t.purple}80; color: ${t.purple}; border-radius: 999px; }
.label { font-family: 'Geist Mono', monospace; font-weight: 500; letter-spacing: .1em; text-transform: uppercase; color: ${t.muted}; }
h1 { font-family: 'Space Grotesk', sans-serif; font-weight: 600; letter-spacing: -.06em; line-height: .92; }
.accent { color: ${t.purple}; }
.sub { color: ${t.muted}; line-height: 1.45; }
.sub b { color: ${t.text}; font-weight: 600; }
.card { background: ${t.card}; border: 1px solid ${t.line}; border-radius: 24px; box-shadow: ${t.shadow}; overflow: hidden; }
.card-row { border-top: 1px solid ${t.line}; }
.mono { font-family: 'Geist Mono', monospace; }
.hex { color: ${t.muted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border: 1px solid ${t.line}; border-radius: 12px; }
.hex .sel { color: ${t.cyan}; }
.story { font-family: 'Space Grotesk', sans-serif; font-weight: 500; letter-spacing: -.035em; line-height: 1.05; }
.cyan { color: ${t.cyan}; }
.stat { font-family: 'Geist Mono', monospace; letter-spacing: -.03em; line-height: 1; }
.was { color: ${t.muted}; text-decoration: line-through; text-decoration-color: ${t.red}; text-decoration-thickness: .06em; }
.chips { display: flex; flex-wrap: wrap; }
.chip { border: 1px solid ${t.lineStrong}; border-radius: 999px; background: ${t.chip}; color: ${t.text}; font-weight: 500; }
.chip i { font-style: normal; color: ${t.purple}; margin-right: .45em; }
.foot { display: flex; align-items: flex-end; justify-content: space-between; margin-top: auto; }
.url { font-weight: 600; letter-spacing: -.01em; }
.fine { color: ${t.muted}; font-family: 'Geist Mono', monospace; letter-spacing: .02em; }
`;

// --- building blocks, sized per format -----------------------------------------------
const brand = (fs) => `<div class="brand" style="font-size:${fs}px">${MARK}<span>Retold<span class="and">&nbsp;·&nbsp;Tripwire</span></span></div>`;
const pill = (fs) => `<span class="pill" style="font-size:${fs}px;padding:${fs * 0.5}px ${fs}px">Read-only · Open source</span>`;
const headline = (fs) => `<h1 style="font-size:${fs}px">Onchain,<br><span class="accent">understood.</span></h1>`;
const sub = (fs, width) =>
  `<p class="sub" style="font-size:${fs}px;max-width:${width}px"><b>Retold</b> reads any EVM wallet in plain English. <b>Tripwire</b> stops a bridge paying out money that was never burned — before it executes.</p>`;

// The receipt: the wallet's calldata, Retold's sentence, and Tripwire's replay.
const card = (s) => `
<div class="card">
  <div style="padding:${s.pad}px ${s.pad}px ${s.pad * 0.9}px">
    <div class="label" style="font-size:${s.label}px">What your wallet shows</div>
    <div class="hex mono" style="font-size:${s.hex}px;padding:${s.hex * 0.7}px ${s.hex}px;margin-top:${s.gap * 0.6}px"><span class="sel">0x7ff36ab5</span>00000000000000000000000000000000000000000000caa7e200…</div>
    <div class="label" style="font-size:${s.label}px;margin-top:${s.gap}px;color:${'var(--cyan)'}">What Retold says <span style="opacity:.7">· illustrative</span></div>
    <div class="story" style="font-size:${s.story}px;margin-top:${s.gap * 0.45}px">Swapped 2.0 ETH for 3,400 USDC</div>
  </div>
  <div class="card-row" style="padding:${s.pad * 0.8}px ${s.pad}px;display:flex;align-items:center;justify-content:space-between;gap:${s.gap}px">
    <div class="label" style="font-size:${s.label}px;line-height:1.55">Tripwire replay<br><span style="color:var(--text)">Kelp DAO bridge drain</span></div>
    <div style="display:flex;align-items:flex-start;gap:${s.gap * 0.8}px">
      <div><div class="stat was" style="font-size:${s.stat}px">$292M</div><div class="label" style="font-size:${s.label * 0.85}px;margin-top:${s.gap * 0.35}px">lost</div></div>
      <div class="stat" style="font-size:${s.stat * 0.7}px;color:var(--muted);padding-top:${s.stat * 0.12}px">→</div>
      <div><div class="stat cyan" style="font-size:${s.stat}px">$0</div><div class="label" style="font-size:${s.label * 0.85}px;margin-top:${s.gap * 0.35}px;white-space:nowrap">with Tripwire</div></div>
    </div>
  </div>
</div>`;

// Tripwire already has the card's lower row, so the chips are Retold's three tools.
const CHIPS = ['Plain-English history', 'Draft Form 8949', 'Check before you sign'];
const chips = (fs) =>
  `<div class="chips" style="gap:${fs * 0.55}px">${CHIPS.map((c) => `<span class="chip" style="font-size:${fs}px;padding:${fs * 0.5}px ${fs * 0.95}px"><i>+</i>${c}</span>`).join('')}</div>`;

const foot = (fs) => `<div class="foot">
  <div><div class="url" style="font-size:${fs * 1.25}px">${SITE}</div>
  <div class="fine" style="font-size:${fs}px;margin-top:${fs * 0.4}px">5 EVM chains · nothing to connect · nothing to sign</div></div>
</div>`;

const FORMATS = {
  '4x5': {
    size: { width: 1080, height: 1350 },
    vars: '--fx-hold:40%;--fx-end:86%;--veil-y:28%',
    body: () => `<div class="content" style="padding:76px 80px 72px">
      <div class="top">${brand(38)}${pill(15)}</div>
      <p class="label" style="font-size:17px;margin-top:64px">The readable chain</p>
      <div style="margin-top:20px">${headline(146)}</div>
      <div style="margin-top:28px">${sub(29, 880)}</div>
      <div style="margin-top:40px">${card({ pad: 32, label: 15, hex: 17, gap: 24, story: 46, stat: 50 })}</div>
      <div style="margin-top:28px">${chips(19)}</div>
      <div style="margin-top:auto;padding-top:32px">${foot(17)}</div>
    </div>`,
  },
  '1x1': {
    size: { width: 1080, height: 1080 },
    vars: '--fx-hold:38%;--fx-end:84%;--veil-y:30%',
    body: () => `<div class="content" style="padding:68px 76px 64px">
      <div class="top">${brand(34)}${pill(14)}</div>
      <div style="margin-top:62px">${headline(128)}</div>
      <div style="margin-top:28px">${sub(26, 860)}</div>
      <div style="margin-top:40px">${card({ pad: 30, label: 14, hex: 16, gap: 22, story: 40, stat: 44 })}</div>
      <div style="margin-top:auto">${foot(16)}</div>
    </div>`,
  },
  '16x9': {
    size: { width: 1600, height: 900 },
    vars: '--fx-hold:45%;--fx-end:95%;--veil-y:45%',
    body: () => `<div class="content" style="padding:64px 88px 60px">
      <div class="top">${brand(36)}${pill(14)}</div>
      <div style="display:grid;grid-template-columns:1fr 700px;gap:64px;align-items:center;margin-top:58px">
        <div>
          <p class="label" style="font-size:16px">The readable chain</p>
          <div style="margin-top:18px">${headline(132)}</div>
          <div style="margin-top:30px">${sub(25, 640)}</div>
        </div>
        ${card({ pad: 32, label: 14, hex: 16, gap: 24, story: 42, stat: 46 })}
      </div>
      <div style="margin-top:44px">${chips(18)}</div>
      <div style="margin-top:auto">${foot(16)}</div>
    </div>`,
  },
  '9x16': {
    size: { width: 1080, height: 1920 },
    // Stories cover the top ~250px and bottom ~300px with UI; everything sits between.
    vars: '--fx-hold:42%;--fx-end:82%;--veil-y:30%',
    body: () => `<div class="content" style="padding:250px 80px 300px">
      <div class="top">${brand(40)}${pill(15)}</div>
      <p class="label" style="font-size:18px;margin-top:110px">The readable chain</p>
      <div style="margin-top:24px">${headline(164)}</div>
      <div style="margin-top:40px">${sub(32, 900)}</div>
      <div style="margin-top:64px">${card({ pad: 36, label: 16, hex: 18, gap: 28, story: 50, stat: 54 })}</div>
      <div style="margin-top:40px">${chips(21)}</div>
      <div style="margin-top:auto;padding-top:48px">${foot(19)}</div>
    </div>`,
  },
};

// The shader, drawn once, at a moment where the ribbons cross behind the card side.
const renderScript = (fx) => `
<script>
(() => {
  const canvas = document.getElementById('fx');
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w; canvas.height = h;
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: true });
  if (!gl) { window.__fx = 'no-webgl'; return; }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, ${JSON.stringify(VERT)}));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, ${JSON.stringify(FRAG)}));
  gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const u = (n) => gl.getUniformLocation(prog, n);
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  gl.viewport(0, 0, w, h);
  gl.uniform2f(u('uRes'), w, h);
  gl.uniform1f(u('uTime'), ${fx.time});
  gl.uniform2f(u('uMouse'), ${fx.mouse[0]}, ${fx.mouse[1]});
  gl.uniform3fv(u('uBg'), rgb(${JSON.stringify(fx.bg)}));
  gl.uniform3fv(u('uC1'), rgb(${JSON.stringify(fx.c1)}));
  gl.uniform3fv(u('uC2'), rgb(${JSON.stringify(fx.c2)}));
  gl.uniform3fv(u('uC3'), rgb(${JSON.stringify(fx.c3)}));
  gl.uniform3fv(u('uC4'), rgb(${JSON.stringify(fx.c4)}));
  gl.uniform1f(u('uIntensity'), ${fx.intensity});
  gl.uniform1f(u('uDark'), ${fx.dark});
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  window.__fx = 'ok';
})();
</script>`;

const page = (theme, format) => {
  const t = THEMES[theme];
  const f = FORMATS[format];
  const fx = { ...t.fx, bg: t.bg, time: 14, mouse: [0.66, 0.6] };
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css(t)}
    :root { --cyan: ${t.cyan}; --muted: ${t.muted}; --text: ${t.text}; }</style></head>
  <body><div class="poster" style="${f.vars}">
    <canvas id="fx"></canvas><div class="grid"></div><div class="veil"></div>
    ${f.body()}
  </div>${renderScript(fx)}</body></html>`;
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

const { chromium } = await loadPlaywright();
// Software WebGL, so the render is the same on any machine, GPU or not.
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
mkdirSync(OUT, { recursive: true });
for (const theme of Object.keys(THEMES)) {
  for (const [format, f] of Object.entries(FORMATS)) {
    const p = await browser.newPage({ viewport: f.size, deviceScaleFactor: 1 });
    await p.setContent(page(theme, format), { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    const fx = await p.evaluate(() => window.__fx);
    if (fx !== 'ok') console.warn(`  ${theme}-${format}: shader did not render (${fx}); the poster falls back to plain canvas`);
    const file = join(OUT, `retold-${theme}-${format}.png`);
    await p.screenshot({ path: file });
    await p.close();
    console.log(`wrote ${file.replace(root + '/', '')}`);
  }
}
await browser.close();
