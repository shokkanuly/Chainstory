// src/components/motion/ShaderField.tsx
//
// A live field of silk light: ribbons of blue, violet and pink that fold and
// drift, and bend toward the pointer. One fragment shader, no textures, no
// library. It replaces the old site-wide SVG backdrop, which sat behind every
// section and made body text fight a moving picture. Now the field belongs to
// the top of a page only (the landing hero, the platform header band) and the
// page below it is plain canvas.
//
// Cost control, because a background must never be the heaviest thing on the
// page:
//   - rendered at a fraction of device resolution; the look is soft anyway
//   - stops drawing when scrolled out of view or when the tab is hidden
//   - under prefers-reduced-motion it draws one still frame and stops
//   - no WebGL (or a lost context): the element keeps a static CSS gradient
//
// Colours are theme tokens (--fx-* in styles/motion.css), re-read when the
// theme changes, so light and dark are two tunings of the same drawing.
// Decorative only: hidden from assistive tech, never takes a click.

import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform vec3 uBg;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uC4;
uniform float uIntensity;
uniform float uDark;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = r * p * 2.03 + 7.1;
    a *= 0.5;
  }
  return v;
}

// Signed distance from a slow, warped curve: the spine of one ribbon.
float spine(vec2 p, float offset, float slope, float t, float seed) {
  float wave = sin(p.x * 1.4 + t * 0.32 + seed) * 0.17 + sin(p.x * 3.1 - t * 0.23 + seed * 2.0) * 0.05;
  float warp = (fbm(vec2(p.x * 0.7 + seed, t * 0.07 + seed)) - 0.5) * 0.5;
  return p.y - (offset + slope * p.x + wave + warp);
}

// One ribbon of silk: a soft body, a bright core where it faces the light,
// and fine threads running along it.
float silk(float d, float width, float f, float twist, float t) {
  float body = exp(-d * d / (width * width));
  float cw = width * 0.22;
  float core = exp(-d * d / (cw * cw)) * (0.35 + 0.9 * twist);
  float threads = pow(0.5 + 0.5 * sin(d * 70.0 + f * 7.0 - t * 0.5), 4.0) * exp(-d * d / (width * width * 0.45));
  return body * 0.32 + core * 0.95 + threads * 0.42 * (0.4 + twist);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime;

  // The pointer is a soft gravity well: the silk leans toward it.
  vec2 m = (uMouse - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec2 dm = p - m;
  p -= dm * 0.2 * exp(-dot(dm, dm) * 2.4);

  vec2 q = vec2(fbm(p * 1.2 + vec2(0.0, t * 0.05)), fbm(p * 1.2 + vec2(5.2, -t * 0.04)));
  float f = fbm(p * 1.0 + q * 2.0 + vec2(t * 0.03, 0.0));
  // Where a ribbon turns toward the light, it brightens.
  float tw1 = pow(0.5 + 0.5 * sin(p.x * 2.3 + f * 5.0 - t * 0.35), 2.0);
  float tw2 = pow(0.5 + 0.5 * sin(p.x * 1.9 - f * 4.0 + t * 0.28 + 1.7), 2.0);
  float tw3 = pow(0.5 + 0.5 * sin(p.y * 2.6 + f * 4.5 - t * 0.3 + 3.1), 2.0);

  // Mirrored so the brightest crossing sits right of centre, away from the copy.
  vec2 pm = vec2(-p.x, p.y);
  float d1 = spine(pm, 0.22, -0.42, t, 0.0);
  float d2 = spine(pm, -0.34, 0.18, t, 2.7);
  float d3 = spine(vec2(pm.y, -pm.x), 0.22, 0.6, t * 0.8, 5.1);

  float g1 = silk(d1, 0.16, f, tw1, t);
  float g2 = silk(d2, 0.12, f, tw2, t + 3.0);
  float g3 = silk(d3, 0.075, f, tw3, t + 6.0) * 0.8;

  float gx = clamp(uv.x + (q.x - 0.5) * 0.6, 0.0, 1.0);
  vec3 colA = mix(uC1, uC2, smoothstep(0.0, 0.55, gx));
  colA = mix(colA, uC3, smoothstep(0.6, 1.0, gx));
  vec3 colB = mix(uC4, uC3, smoothstep(0.0, 0.45, gx));
  colB = mix(colB, uC2, smoothstep(0.45, 1.0, gx));
  vec3 colC = mix(uC2, uC1, uv.y);

  // A faint haze keeps the gaps from reading as holes, without filling them.
  float haze = smoothstep(0.45, 1.0, f) * 0.07;

  vec3 col = colA * g1 + colB * g2 + colC * g3 + mix(uC2, uC1, q.y) * haze;
  float a = g1 + g2 + g3 + haze;
  col *= uIntensity;
  a *= uIntensity;

  vec3 outc;
  if (uDark > 0.5) {
    // Light added to the dark, with a soft shoulder so overlaps glow, not clip.
    outc = uBg + (1.0 - exp(-col * 1.35));
  } else {
    // Pastel laid over the light canvas, kept thin so dark text stays legible.
    outc = mix(uBg, col / max(a, 0.001), clamp(a * 0.55, 0.0, 0.85));
  }
  // A little grain so the gradients do not band.
  outc += (hash(gl_FragCoord.xy + fract(t)) - 0.5) * (2.0 / 255.0);
  gl_FragColor = vec4(outc, 1.0);
}
`;

type RGB = [number, number, number];

/** Resolves any CSS colour string to 0..1 RGB, using the browser's own parser. */
function parseColor(ctx: CanvasRenderingContext2D, value: string, fallback: RGB): RGB {
  ctx.fillStyle = '#000';
  ctx.fillStyle = value.trim() || '#000';
  const s = String(ctx.fillStyle);
  if (s.startsWith('#') && s.length === 7) {
    return [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(',').map((x) => parseFloat(x));
    if ([r, g, b].every(Number.isFinite)) return [r / 255, g / 255, b / 255];
  }
  return fallback;
}

interface Palette {
  bg: RGB;
  c1: RGB;
  c2: RGB;
  c3: RGB;
  c4: RGB;
  intensity: number;
  dark: boolean;
}

function readPalette(el: Element, ctx: CanvasRenderingContext2D): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name);
  const intensity = parseFloat(v('--fx-intensity'));
  return {
    bg: parseColor(ctx, v('--b-canvas'), [0.05, 0.05, 0.07]),
    c1: parseColor(ctx, v('--fx-blue'), [0.23, 0.36, 1]),
    c2: parseColor(ctx, v('--fx-violet'), [0.55, 0.24, 1]),
    c3: parseColor(ctx, v('--fx-pink'), [0.88, 0.26, 0.6]),
    c4: parseColor(ctx, v('--fx-peach'), [0.94, 0.54, 0.42]),
    intensity: Number.isFinite(intensity) ? intensity : 1,
    dark: v('--fx-mode').trim() !== 'light',
  };
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

export default function ShaderField({
  className = '',
  intensity = 1,
  resolution = 0.5,
  speed = 1,
}: {
  className?: string;
  /** Multiplies the theme's --fx-intensity. The platform band runs quieter than the hero. */
  intensity?: number;
  /** Fraction of device pixels actually shaded. The field is soft, so half is plenty. */
  resolution?: number;
  speed?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    const parseCtx = document.createElement('canvas').getContext('2d');
    if (!gl || !parseCtx) return; // The CSS gradient on the wrapper stays as the fallback.

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = (n: string) => gl.getUniformLocation(prog, n);
    const U = {
      res: u('uRes'),
      time: u('uTime'),
      mouse: u('uMouse'),
      bg: u('uBg'),
      c1: u('uC1'),
      c2: u('uC2'),
      c3: u('uC3'),
      c4: u('uC4'),
      intensity: u('uIntensity'),
      dark: u('uDark'),
    };

    const applyPalette = () => {
      const p = readPalette(wrap, parseCtx);
      gl.uniform3fv(U.bg, p.bg);
      gl.uniform3fv(U.c1, p.c1);
      gl.uniform3fv(U.c2, p.c2);
      gl.uniform3fv(U.c3, p.c3);
      gl.uniform3fv(U.c4, p.c4);
      gl.uniform1f(U.intensity, p.intensity * intensity);
      gl.uniform1f(U.dark, p.dark ? 1 : 0);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(wrap.clientWidth * dpr * resolution));
      const h = Math.max(1, Math.round(wrap.clientHeight * dpr * resolution));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(U.res, w, h);
    };

    // Pointer, eased so the silk follows like cloth rather than tracking like a cursor.
    const target = { x: 0.62, y: 0.55 };
    const mouse = { x: 0.62, y: 0.55 };
    const onPointer = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      target.x = (e.clientX - r.left) / r.width;
      target.y = 1 - (e.clientY - r.top) / r.height;
    };

    // Start mid-flow so the first frame is already interesting.
    let time = 14;
    let last = 0;
    let raf = 0;
    let visible = true;
    let running = false;

    const draw = () => {
      gl.uniform1f(U.time, time);
      gl.uniform2f(U.mouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const frame = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;
      time += dt * speed;
      mouse.x += (target.x - mouse.x) * Math.min(1, dt * 2.2);
      mouse.y += (target.y - mouse.y) * Math.min(1, dt * 2.2);
      draw();
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running || reduce) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const sync = () => (visible && !document.hidden ? start() : stop());

    resize();
    applyPalette();
    draw();
    wrap.dataset.fxReady = 'true';

    const ro = new ResizeObserver(() => {
      resize();
      if (!running) draw();
    });
    ro.observe(wrap);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    io.observe(wrap);

    // Theme switches: attribute on <html>, or the OS preference under "system".
    const refresh = () => {
      applyPalette();
      if (!running) draw();
    };
    const mo = new MutationObserver(refresh);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', refresh);

    const onLost = (e: Event) => {
      e.preventDefault();
      stop();
      delete wrap.dataset.fxReady;
    };
    canvas.addEventListener('webglcontextlost', onLost);
    document.addEventListener('visibilitychange', sync);
    if (!reduce) window.addEventListener('pointermove', onPointer, { passive: true });
    sync();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      mq.removeEventListener('change', refresh);
      canvas.removeEventListener('webglcontextlost', onLost);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('pointermove', onPointer);
      delete wrap.dataset.fxReady;
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [reduce, intensity, resolution, speed]);

  return (
    <div ref={wrapRef} className={`fx-field ${className}`} aria-hidden="true">
      <canvas ref={canvasRef} className="fx-field-canvas" />
    </div>
  );
}
