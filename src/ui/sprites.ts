// Simple procedural graphics, drawn with canvas paths and gradients (no image files).
// Every function draws centred on (x, y) with a size in screen pixels.
import { makeRng } from '../game/rng';
import type { EnemyType, ShipType } from '../game/types';

type Ctx = CanvasRenderingContext2D;

export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---- Background ------------------------------------------------------------------

let bgCache: { w: number; h: number; tint: string; canvas: HTMLCanvasElement } | null = null;

/** Nebula clouds, cached per screen size. */
function nebula(w: number, h: number, tint: 'home' | 'anomaly'): HTMLCanvasElement {
  if (bgCache && bgCache.w === w && bgCache.h === h && bgCache.tint === tint) return bgCache.canvas;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * 1.4));
  c.height = Math.max(1, Math.round(h * 1.4));
  const g = c.getContext('2d')!;
  const rng = makeRng(tint === 'home' ? 11 : 23);
  const colors = tint === 'home'
    ? ['rgba(60,90,200,', 'rgba(110,60,180,', 'rgba(30,140,170,']
    : ['rgba(170,40,140,', 'rgba(110,30,170,', 'rgba(200,60,90,'];
  for (let i = 0; i < 9; i++) {
    const x = rng.next() * c.width;
    const y = rng.next() * c.height;
    const r = (0.2 + rng.next() * 0.35) * Math.max(c.width, c.height);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const col = colors[i % colors.length];
    grad.addColorStop(0, `${col}${0.1 + rng.next() * 0.08})`);
    grad.addColorStop(1, `${col}0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
  }
  bgCache = { w, h, tint, canvas: c };
  return c;
}

const STARS = (() => {
  const rng = makeRng(99);
  return Array.from({ length: 420 }, () => ({ x: rng.next(), y: rng.next(), b: rng.next(), layer: rng.int(1, 3) }));
})();

/** Nebula + three parallax star layers that move a little with the camera. */
export function drawBackground(ctx: Ctx, w: number, h: number, camX: number, camY: number, tint: 'home' | 'anomaly', base: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const neb = nebula(w, h, tint);
  ctx.drawImage(neb, -w * 0.2 + camX * 0.05, -h * 0.2 + camY * 0.05);
  const area = (w * h) / (1280 * 800);
  const count = Math.min(STARS.length, Math.round(STARS.length * Math.max(0.35, area)));
  for (let i = 0; i < count; i++) {
    const st = STARS[i];
    const f = st.layer * 0.06;
    const x = (((st.x * w + camX * f) % w) + w) % w;
    const y = (((st.y * h + camY * f) % h) + h) % h;
    const s = st.layer === 3 && st.b > 0.7 ? 2 : 1;
    ctx.fillStyle = `rgba(210,222,255,${0.15 + st.b * 0.55})`;
    ctx.fillRect(x, y, s, s);
  }
}

// ---- Planets ---------------------------------------------------------------------

const planetCache = new Map<string, HTMLCanvasElement>();

const PLANET_PALETTE = {
  garden: { base: ['#2f8fb8', '#1d5f8a'], land: ['#4fcf8c', '#3aa86d', '#7ad99a'], glow: '95,224,176' },
  rock: { base: ['#c98a4b', '#8a5530'], land: ['#a86b3c', '#e0a865', '#7a4a2a'], glow: '232,169,91' },
};

/** Planet texture, cached per planet, colonized state and size. */
function planetTexture(id: string, type: 'garden' | 'rock', colonized: boolean, r: number): HTMLCanvasElement {
  const rb = Math.max(4, Math.round(r / 3) * 3);
  const key = `${id}|${type}|${colonized}|${rb}`;
  const hit = planetCache.get(key);
  if (hit) return hit;
  const pad = rb * 0.5;
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = (rb + pad) * 2;
  c.width = Math.ceil(size * dpr);
  c.height = Math.ceil(size * dpr);
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  const cx = size / 2;
  const pal = PLANET_PALETTE[type];
  const rng = makeRng(hashId(id));

  // atmosphere glow
  const glow = g.createRadialGradient(cx, cx, rb * 0.9, cx, cx, rb + pad);
  glow.addColorStop(0, `rgba(${pal.glow},${colonized ? 0.35 : 0.15})`);
  glow.addColorStop(1, `rgba(${pal.glow},0)`);
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);

  g.save();
  g.beginPath();
  g.arc(cx, cx, rb, 0, Math.PI * 2);
  g.clip();
  const base = g.createLinearGradient(cx - rb, cx - rb, cx + rb, cx + rb);
  base.addColorStop(0, pal.base[0]);
  base.addColorStop(1, pal.base[1]);
  g.fillStyle = base;
  g.fillRect(cx - rb, cx - rb, rb * 2, rb * 2);

  // continents / plateaus
  for (let i = 0; i < 9; i++) {
    g.fillStyle = pal.land[i % pal.land.length];
    g.globalAlpha = 0.75;
    g.beginPath();
    const bx = cx + (rng.next() - 0.5) * rb * 1.8;
    const by = cx + (rng.next() - 0.5) * rb * 1.8;
    g.ellipse(bx, by, rb * (0.15 + rng.next() * 0.35), rb * (0.1 + rng.next() * 0.25), rng.next() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  if (type === 'rock') {
    for (let i = 0; i < 6; i++) {
      const x = cx + (rng.next() - 0.5) * rb * 1.5;
      const y = cx + (rng.next() - 0.5) * rb * 1.5;
      const cr = rb * (0.06 + rng.next() * 0.1);
      g.fillStyle = 'rgba(60,30,15,0.45)';
      g.beginPath();
      g.arc(x, y, cr, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,220,170,0.25)';
      g.lineWidth = Math.max(0.5, cr * 0.25);
      g.beginPath();
      g.arc(x - cr * 0.15, y - cr * 0.15, cr, Math.PI * 0.9, Math.PI * 1.7);
      g.stroke();
    }
  } else {
    // cloud bands
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.lineWidth = rb * 0.08;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      const y = cx + (rng.next() - 0.5) * rb * 1.4;
      g.ellipse(cx, y, rb * 0.9, rb * 0.12, rng.next() * 0.4 - 0.2, 0, Math.PI);
      g.stroke();
    }
  }

  // night side
  const shade = g.createLinearGradient(cx - rb * 0.6, cx - rb * 0.6, cx + rb, cx + rb);
  shade.addColorStop(0, 'rgba(0,0,15,0)');
  shade.addColorStop(0.55, 'rgba(0,0,15,0.15)');
  shade.addColorStop(1, 'rgba(0,0,15,0.85)');
  g.fillStyle = shade;
  g.fillRect(cx - rb, cx - rb, rb * 2, rb * 2);

  // city lights on the night side
  if (colonized) {
    g.fillStyle = 'rgba(255,214,120,0.9)';
    for (let i = 0; i < 14; i++) {
      const a = Math.PI * 0.1 + rng.next() * Math.PI * 0.8;
      const d = rb * (0.45 + rng.next() * 0.45);
      const x = cx + Math.cos(a) * d * 0.9;
      const y = cx + Math.sin(a) * d * 0.9;
      g.fillRect(x, y, Math.max(1, rb * 0.04), Math.max(1, rb * 0.04));
    }
  }
  g.restore();

  // rim light
  g.strokeStyle = `rgba(${pal.glow},0.55)`;
  g.lineWidth = Math.max(1, rb * 0.05);
  g.beginPath();
  g.arc(cx, cx, rb - g.lineWidth / 2, Math.PI * 0.95, Math.PI * 1.75);
  g.stroke();

  if (!colonized) {
    // desaturate unclaimed worlds a little
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(20,26,45,0.45)';
    g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = 'source-over';
  }
  if (planetCache.size > 300) planetCache.clear();
  planetCache.set(key, c);
  return c;
}

export function drawPlanet(ctx: Ctx, x: number, y: number, r: number, id: string, type: 'garden' | 'rock', colonized: boolean) {
  const tex = planetTexture(id, type, colonized, r);
  const rb = Math.max(4, Math.round(r / 3) * 3);
  const size = rb * 3;
  const scale = r / rb;
  ctx.drawImage(tex, x - (size / 2) * scale, y - (size / 2) * scale, size * scale, size * scale);
}

// ---- Stations --------------------------------------------------------------------

/** Home base: hub with a rotating habitat ring and blinking lights. */
export function drawBase(ctx: Ctx, x: number, y: number, r: number, t: number) {
  ctx.save();
  ctx.translate(x, y);
  const glow = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.3);
  glow.addColorStop(0, 'rgba(95,212,255,0.25)');
  glow.addColorStop(1, 'rgba(95,212,255,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(t * 0.00025);
  ctx.strokeStyle = '#9fb4d8';
  ctx.lineWidth = Math.max(1.5, r * 0.12);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#5fd4ff';
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
  ctx.stroke();
  // spokes and habitat pods
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.strokeStyle = '#7d8fb3';
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.beginPath();
    ctx.moveTo(r * 0.3, 0);
    ctx.lineTo(r * 0.8, 0);
    ctx.stroke();
    ctx.fillStyle = '#c8d6f0';
    ctx.fillRect(r * 0.75, -r * 0.1, r * 0.2, r * 0.2);
    const on = Math.floor(t / 600 + i) % 4 === 0;
    ctx.fillStyle = on ? '#ffe28a' : '#3d4a66';
    ctx.beginPath();
    ctx.arc(r * 0.85, 0, Math.max(1, r * 0.05), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // hub
  const hub = ctx.createRadialGradient(x - r * 0.1, y - r * 0.1, r * 0.05, x, y, r * 0.35);
  hub.addColorStop(0, '#e9f6ff');
  hub.addColorStop(1, '#3a7fa8');
  ctx.fillStyle = hub;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.32, 0, Math.PI * 2);
  ctx.fill();
}

/** Trade post: a hull with two slowly turning solar wings, cargo pods show its stock. */
export function drawStation(ctx: Ctx, x: number, y: number, r: number, t: number, stockFrac: number, seed: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(t * 0.0003 + seed) * 0.25);
  // solar wings
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#2b3f7a';
    ctx.strokeStyle = '#7f9ef0';
    ctx.lineWidth = 1;
    ctx.fillRect(side > 0 ? r * 0.35 : -r * 1.05, -r * 0.22, r * 0.7, r * 0.44);
    ctx.strokeRect(side > 0 ? r * 0.35 : -r * 1.05, -r * 0.22, r * 0.7, r * 0.44);
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const lx = (side > 0 ? r * 0.35 : -r * 1.05) + (r * 0.7 * i) / 4;
      ctx.moveTo(lx, -r * 0.22);
      ctx.lineTo(lx, r * 0.22);
    }
    ctx.strokeStyle = 'rgba(127,158,240,0.5)';
    ctx.stroke();
  }
  // hull
  ctx.fillStyle = '#b48cff';
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.55);
  ctx.lineTo(r * 0.38, 0);
  ctx.lineTo(0, r * 0.55);
  ctx.lineTo(-r * 0.38, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e4d6ff';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // cargo pods underneath (one per ~20 % stock)
  const pods = Math.round(stockFrac * 5);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < pods ? '#f5c15c' : 'rgba(245,193,92,0.15)';
    ctx.fillRect(x - r * 0.5 + i * r * 0.21, y + r * 0.7, r * 0.16, r * 0.16);
  }
}

/** Asteroid field: a few irregular rocks that turn slowly; fewer rocks show a depleted field. */
export function drawAsteroids(ctx: Ctx, x: number, y: number, r: number, t: number, seed: number, frac: number) {
  const rng = makeRng(seed);
  const rocks = 6;
  for (let i = 0; i < rocks; i++) {
    const ox = (rng.next() - 0.5) * r * 1.4;
    const oy = (rng.next() - 0.5) * r * 1.2;
    const size = r * (0.14 + rng.next() * 0.18);
    const spin = (rng.next() - 0.5) * 0.0008;
    const verts = 7;
    const radii = Array.from({ length: verts }, () => 0.7 + rng.next() * 0.45);
    if (i / rocks > frac + 0.15) continue;
    ctx.save();
    ctx.translate(x + ox, y + oy);
    ctx.rotate(t * spin + i);
    const g = ctx.createLinearGradient(-size, -size, size, size);
    g.addColorStop(0, '#b3aa9c');
    g.addColorStop(1, '#4d4740');
    ctx.fillStyle = g;
    ctx.beginPath();
    radii.forEach((rr, k) => {
      const a = (k / verts) * Math.PI * 2;
      const px = Math.cos(a) * size * rr;
      const py = Math.sin(a) * size * rr;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
    // ore veins
    ctx.fillStyle = 'rgba(232,169,91,0.85)';
    ctx.fillRect(-size * 0.2, -size * 0.1, size * 0.25, size * 0.12);
    ctx.restore();
  }
}

// ---- Ships & enemies -------------------------------------------------------------

export const SHIP_COLORS: Record<ShipType, string> = { hauler: '#f5c15c', miner: '#7ee0a1', warden: '#6fb6ff' };

/** Ship pointing along +x. `thrust` 0..1 shows the engine flame. */
export function drawShipSprite(ctx: Ctx, type: ShipType, x: number, y: number, angle: number, r: number, thrust: number, t: number) {
  const col = SHIP_COLORS[type];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  if (thrust > 0.05) {
    const flick = 0.75 + 0.25 * Math.sin(t * 0.05 + x);
    const len = r * (0.8 + thrust * 1.2) * flick;
    const engines = type === 'hauler' ? [-0.35, 0.35] : [0];
    for (const ey of engines) {
      const g = ctx.createLinearGradient(-r * 0.6, 0, -r * 0.6 - len, 0);
      g.addColorStop(0, 'rgba(255,240,200,0.95)');
      g.addColorStop(0.4, 'rgba(120,200,255,0.7)');
      g.addColorStop(1, 'rgba(80,140,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, ey * r - r * 0.16);
      ctx.lineTo(-r * 0.6 - len, ey * r);
      ctx.lineTo(-r * 0.6, ey * r + r * 0.16);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.lineJoin = 'round';
  if (type === 'hauler') {
    // long body with cargo containers
    ctx.fillStyle = '#5a6378';
    ctx.fillRect(-r * 0.7, -r * 0.12, r * 1.4, r * 0.24);
    ctx.fillStyle = col;
    for (const cx of [-0.5, -0.15, 0.2]) {
      ctx.fillRect(cx * r, -r * 0.5, r * 0.3, r * 0.36);
      ctx.fillRect(cx * r, r * 0.14, r * 0.3, r * 0.36);
    }
    ctx.fillStyle = '#d9e2f5';
    ctx.beginPath();
    ctx.moveTo(r * 0.55, -r * 0.25);
    ctx.lineTo(r * 0.95, 0);
    ctx.lineTo(r * 0.55, r * 0.25);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'miner') {
    // stubby hull with a drill arm in front
    ctx.fillStyle = '#c4ccdb';
    ctx.beginPath();
    ctx.moveTo(r * 0.5, 0);
    ctx.lineTo(r * 0.75, -r * 0.12);
    ctx.lineTo(r * 1.0, 0);
    ctx.lineTo(r * 0.75, r * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(r * 0.55, -r * 0.3);
    ctx.lineTo(r * 0.1, -r * 0.6);
    ctx.lineTo(-r * 0.6, -r * 0.45);
    ctx.lineTo(-r * 0.6, r * 0.45);
    ctx.lineTo(r * 0.1, r * 0.6);
    ctx.lineTo(r * 0.55, r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2e4a3c';
    ctx.fillRect(-r * 0.3, -r * 0.18, r * 0.5, r * 0.36);
  } else {
    // sleek arrow with swept wings
    ctx.fillStyle = '#3d5f99';
    ctx.beginPath();
    ctx.moveTo(r * 0.1, -r * 0.2);
    ctx.lineTo(-r * 0.55, -r * 0.85);
    ctx.lineTo(-r * 0.35, -r * 0.1);
    ctx.moveTo(r * 0.1, r * 0.2);
    ctx.lineTo(-r * 0.55, r * 0.85);
    ctx.lineTo(-r * 0.35, r * 0.1);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(r * 1.05, 0);
    ctx.lineTo(-r * 0.6, -r * 0.3);
    ctx.lineTo(-r * 0.4, 0);
    ctx.lineTo(-r * 0.6, r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e8f3ff';
    ctx.beginPath();
    ctx.ellipse(r * 0.35, 0, r * 0.18, r * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawEnemySprite(ctx: Ctx, type: EnemyType, x: number, y: number, r: number, t: number, seed: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * (type === 'colossus' ? 0.0004 : 0.002) + seed);
  const glow = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.5);
  glow.addColorStop(0, 'rgba(255,60,90,0.35)');
  glow.addColorStop(1, 'rgba(255,60,90,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
  ctx.fill();
  if (type === 'colossus') {
    ctx.fillStyle = '#5a1420';
    ctx.strokeStyle = '#ff5d6c';
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ff5d6c';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.3 * (0.85 + 0.15 * Math.sin(t * 0.008)), 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#ff5d6c';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rr = i % 2 === 0 ? r : r * 0.4;
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd1d6';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---- Expedition objects ----------------------------------------------------------

/** Glowing crystal cluster; dims when empty. */
export function drawCrystals(ctx: Ctx, x: number, y: number, r: number, t: number, seed: number, full: boolean) {
  const pulse = full ? 0.75 + 0.25 * Math.sin(t * 0.003 + seed) : 0.2;
  if (full) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 1.2);
    glow.addColorStop(0, `rgba(255,123,242,${0.35 * pulse})`);
    glow.addColorStop(1, 'rgba(255,123,242,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const rng = makeRng(seed);
  for (let i = 0; i < 5; i++) {
    const ox = (rng.next() - 0.5) * r * 0.9;
    const h = r * (0.35 + rng.next() * 0.45);
    const wdt = h * 0.32;
    const tilt = (rng.next() - 0.5) * 0.7;
    ctx.save();
    ctx.translate(x + ox, y + r * 0.25);
    ctx.rotate(tilt);
    const g = ctx.createLinearGradient(-wdt, -h, wdt, 0);
    g.addColorStop(0, full ? '#ffd6fb' : '#6b5a75');
    g.addColorStop(1, full ? '#c03fb3' : '#3a3242');
    ctx.globalAlpha = full ? 1 : 0.5;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(wdt, -h * 0.65);
    ctx.lineTo(wdt * 0.8, 0);
    ctx.lineTo(-wdt * 0.8, 0);
    ctx.lineTo(-wdt, -h * 0.65);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/** The jump gate: a swirling vortex inside a ring. */
export function drawGate(ctx: Ctx, x: number, y: number, r: number, t: number) {
  const core = ctx.createRadialGradient(x, y, 0, x, y, r);
  core.addColorStop(0, 'rgba(220,250,255,0.9)');
  core.addColorStop(0.35, 'rgba(95,212,255,0.45)');
  core.addColorStop(1, 'rgba(60,80,200,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y);
  for (let i = 0; i < 5; i++) {
    ctx.rotate(t * 0.0012 + (i * Math.PI * 2) / 5);
    ctx.strokeStyle = `rgba(150,230,255,${0.7 - i * 0.1})`;
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.beginPath();
    ctx.arc(0, 0, r * (0.35 + i * 0.1), 0, Math.PI * 0.9);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = '#9fb4d8';
  ctx.lineWidth = Math.max(2, r * 0.12);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.fillStyle = Math.floor(t / 400) % 6 === i ? '#ffffff' : '#5fd4ff';
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92, Math.max(1.5, r * 0.07), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Beam between two points (weapons, mining). */
export function drawBeam(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, width: number, t: number) {
  ctx.save();
  ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 0.04 + x1);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}
