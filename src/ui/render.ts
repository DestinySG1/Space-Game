// Canvas drawing for the home sector and the expedition map, with camera, smooth flight and effects.
import { CONFIG } from '../game/config';
import { shipStats } from '../game/economy';
import { GATE, expeditionShips } from '../game/expedition';
import { hexDistance, hexEq, hexLine, hexToPixel, hexesInRadius } from '../game/hex';
import { nodeAt, nodeById } from '../game/state';
import type { Enemy, GameState, Hex, Ship } from '../game/types';
import { clampCamera, type Camera } from './camera';
import {
  SHIP_COLORS, drawAsteroids, drawBackground, drawBase, drawBeam, drawCrystals, drawEnemySprite, drawGate, drawPlanet,
  drawShipSprite, drawStation, hashId,
} from './sprites';
import type { UIState } from './ui-state';

const C = {
  grid: 'rgba(120,150,220,0.09)',
  gridHover: 'rgba(140,180,255,0.16)',
  sel: '#ffffff',
  text: '#dbe4ff',
  dim: '#8692b5',
  hull: '#7ee0a1',
  shield: '#6fb6ff',
  enemy: '#ff5d6c',
  shard: '#ff7bf2',
  ore: '#e8a95b',
};

export interface View {
  cx: number;
  cy: number;
  size: number; // screen pixels per hex (radius)
  radius: number;
}

export interface DrawResult {
  view: View;
  shipPos: Map<string, { x: number; y: number }>;
  mapRadiusPx: number;
}

export function computeView(w: number, h: number, radius: number, cam: Camera): View & { base: number } {
  const base = Math.min(w / (Math.sqrt(3) * (2 * radius + 1)), h / (3 * radius + 2)) * 0.96;
  return { cx: w / 2 + cam.x, cy: h / 2 + cam.y, size: base * cam.zoom, radius, base };
}

const world = (h: Hex) => hexToPixel(h, 1);
const toScreen = (v: View, p: { x: number; y: number }) => ({ x: v.cx + p.x * v.size, y: v.cy + p.y * v.size });
const hexScreen = (v: View, h: Hex) => toScreen(v, world(h));

// ---- smooth visual motion ------------------------------------------------------------

interface Visual {
  x: number;
  y: number;
  a: number;
  thrust: number;
  trail: { x: number; y: number }[];
  seen: number;
}
const visuals = new Map<string, Visual>();

/** Exact simulated position of something moving along a hex path (world units). */
function simPos(m: { hex: Hex; path: Hex[]; progress: number }) {
  const a = world(m.hex);
  if (!m.path.length) return { ...a, moving: false, dir: 0 };
  const b = world(m.path[0]);
  return { x: a.x + (b.x - a.x) * m.progress, y: a.y + (b.y - a.y) * m.progress, moving: true, dir: Math.atan2(b.y - a.y, b.x - a.x) };
}

function lerpAngle(a: number, b: number, k: number) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}

/**
 * Ease the drawn position toward the simulated one. Idle things circle their hex slowly,
 * moving things face their direction and leave a short engine trail.
 */
function animate(key: string, m: { hex: Hex; path: Hex[]; progress: number }, now: number, dt: number, orbit: number, orbitSpeed: number): Visual {
  const p = simPos(m);
  const seed = hashId(key);
  let tx = p.x;
  let ty = p.y;
  let ta = p.dir;
  if (!p.moving && orbit > 0) {
    const dirSign = seed % 2 ? 1 : -1;
    const phase = ((seed % 1000) / 1000) * Math.PI * 2 + (now / 1000) * orbitSpeed * dirSign;
    tx += Math.cos(phase) * orbit;
    ty += Math.sin(phase) * orbit;
    ta = phase + (Math.PI / 2) * dirSign;
  }
  let v = visuals.get(key);
  if (!v || Math.hypot(v.x - tx, v.y - ty) > 3) {
    v = { x: tx, y: ty, a: ta, thrust: 0, trail: [], seen: now };
    visuals.set(key, v);
  }
  const k = 1 - Math.exp(-dt * 6);
  const px = v.x;
  const py = v.y;
  v.x += (tx - v.x) * k;
  v.y += (ty - v.y) * k;
  const speed = Math.hypot(v.x - px, v.y - py) / Math.max(dt, 1e-3);
  if (speed > 0.02) ta = Math.atan2(v.y - py, v.x - px);
  v.a = lerpAngle(v.a, ta, 1 - Math.exp(-dt * 8));
  v.thrust += ((p.moving ? 1 : 0.15) - v.thrust) * (1 - Math.exp(-dt * 4));
  if (p.moving) {
    v.trail.push({ x: v.x, y: v.y });
    if (v.trail.length > 26) v.trail.shift();
  } else if (v.trail.length) {
    v.trail.shift();
  }
  v.seen = now;
  return v;
}

function pruneVisuals(now: number) {
  for (const [k, v] of visuals) if (now - v.seen > 2000) visuals.delete(k);
}

// ---- shared pieces ---------------------------------------------------------------

function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    const px = x + size * Math.cos(a);
    const py = y + size * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawGrid(ctx: CanvasRenderingContext2D, v: View, ui: UIState) {
  ctx.lineWidth = 1;
  for (const h of hexesInRadius(v.radius)) {
    const p = hexScreen(v, h);
    hexPath(ctx, p.x, p.y, v.size * 0.98);
    if (ui.hoverHex && hexEq(ui.hoverHex, h)) {
      ctx.fillStyle = C.gridHover;
      ctx.fill();
    }
    ctx.strokeStyle = C.grid;
    ctx.stroke();
  }
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, frac: number, color: string) {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - w / 2, y, w, 3);
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, frac)), 3);
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = C.dim, px = 11) {
  ctx.font = `${px}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(5,8,18,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawTrail(ctx: CanvasRenderingContext2D, v: View, vis: Visual, color: string, width: number) {
  if (vis.trail.length < 2) return;
  ctx.lineCap = 'round';
  for (let i = 1; i < vis.trail.length; i++) {
    const a = toScreen(v, vis.trail[i - 1]);
    const b = toScreen(v, vis.trail[i]);
    ctx.globalAlpha = (i / vis.trail.length) * 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * (i / vis.trail.length);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawPreview(ctx: CanvasRenderingContext2D, v: View, ui: UIState, ship: Ship | undefined) {
  if (!ship || !ui.hoverHex) return;
  const from = ship.path.length ? ship.path[0] : ship.hex;
  if (hexEq(from, ui.hoverHex)) return;
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const a = hexScreen(v, from);
  ctx.moveTo(a.x, a.y);
  for (const h of hexLine(from, ui.hoverHex)) {
    const p = hexScreen(v, h);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  const end = hexScreen(v, ui.hoverHex);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(end.x, end.y, v.size * 0.2, 0, Math.PI * 2);
  ctx.stroke();
}

function drawShipAt(ctx: CanvasRenderingContext2D, s: GameState, v: View, ship: Ship, vis: Visual, r: number, selected: boolean, now: number, showBars: boolean) {
  const p = toScreen(v, vis);
  drawTrail(ctx, v, vis, SHIP_COLORS[ship.type], Math.max(1.5, r * 0.35));
  if (selected) {
    ctx.strokeStyle = C.sel;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawShipSprite(ctx, ship.type, p.x, p.y, vis.a, r, vis.thrust, now);
  const st = shipStats(s, ship.type);
  if (showBars || selected || ship.hull < st.hull - 1 || ship.shield < st.shield - 1) {
    bar(ctx, p.x, p.y + r * 1.3, r * 2.6, ship.hull / st.hull, C.hull);
    if (st.shield > 0) bar(ctx, p.x, p.y + r * 1.3 + 4, r * 2.6, ship.shield / st.shield, C.shield);
  }
  return p;
}

// ---- home sector ------------------------------------------------------------------

export function drawHome(ctx: CanvasRenderingContext2D, s: GameState, ui: UIState, w: number, h: number, now: number, dt: number): DrawResult {
  const cam = ui.cams.home;
  const v0 = computeView(w, h, CONFIG.sector.radius, cam);
  const mapRadiusPx = v0.base * (CONFIG.sector.radius + 1) * 1.6;
  clampCamera(cam, mapRadiusPx);
  const v = computeView(w, h, CONFIG.sector.radius, cam);
  const z = v.size;
  drawBackground(ctx, w, h, cam.x, cam.y, 'home', '#060a15');
  drawGrid(ctx, v, ui);
  const ships = s.ships.filter((x) => x.location === 'home');

  // shuttle routes
  ctx.setLineDash([2, 7]);
  for (const sh of ships) {
    if (!sh.shuttle) continue;
    const a = nodeById(s, sh.shuttle.a);
    const b = nodeById(s, sh.shuttle.b);
    if (!a || !b) continue;
    const pa = hexScreen(v, a.hex);
    const pb = hexScreen(v, b.hex);
    ctx.strokeStyle = SHIP_COLORS[sh.type] + '55';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // nodes
  for (const n of s.nodes) {
    const p = hexScreen(v, n.hex);
    if (p.x < -z * 2 || p.y < -z * 2 || p.x > w + z * 2 || p.y > h + z * 2) continue;
    if (ui.selNode === n.id) {
      hexPath(ctx, p.x, p.y, z * 0.98);
      ctx.strokeStyle = C.sel;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (n.kind === 'base') drawBase(ctx, p.x, p.y, z * 0.5, now);
    else if (n.kind === 'planet') {
      drawPlanet(ctx, p.x, p.y, z * 0.4, n.id, n.planetType ?? 'rock', n.level > 0);
      if (n.level > 0) {
        ctx.fillStyle = 'rgba(6,10,21,0.85)';
        ctx.beginPath();
        ctx.arc(p.x + z * 0.32, p.y - z * 0.32, Math.max(7, z * 0.14), 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `600 ${Math.max(9, z * 0.16)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = n.planetType === 'garden' ? '#5fe0b0' : '#e8a95b';
        ctx.fillText(String(n.level), p.x + z * 0.32, p.y - z * 0.31);
      }
    } else if (n.kind === 'station') drawStation(ctx, p.x, p.y, z * 0.42, now, n.stock / CONFIG.station.stockCap, hashId(n.id) % 10);
    else if (n.kind === 'asteroid') drawAsteroids(ctx, p.x, p.y, z * 0.5, now, hashId(n.id), n.ore / CONFIG.asteroid.oreMax);
  }

  // mining beams: a miner sitting on a belt with room in its hold
  for (const sh of ships) {
    if (sh.type !== 'miner' || sh.path.length) continue;
    const n = nodeAt(s, sh.hex);
    if (n?.kind !== 'asteroid' || n.ore < 1 || sh.cargo >= shipStats(s, 'miner').cargoHome - 1e-6) continue;
    const vis = visuals.get(`h:${sh.id}`);
    if (!vis) continue;
    const a = toScreen(v, vis);
    const b = hexScreen(v, n.hex);
    drawBeam(ctx, a.x, a.y, b.x, b.y, C.ore, Math.max(1, z * 0.04), now);
  }

  drawPreview(ctx, v, ui, ships.find((x) => x.id === ui.selShip));
  const shipPos = new Map<string, { x: number; y: number }>();
  const r = Math.max(5, z * 0.17);
  for (const sh of ships) {
    const vis = animate(`h:${sh.id}`, sh, now, dt, 0.42, 0.35);
    shipPos.set(sh.id, drawShipAt(ctx, s, v, sh, vis, r, ui.selShip === sh.id, now, false));
  }

  if (z > 20) {
    for (const n of s.nodes) {
      const p = hexScreen(v, n.hex);
      label(ctx, n.name, p.x, p.y + z * 0.62, ui.selNode === n.id ? C.text : C.dim, Math.max(10, Math.min(13, z * 0.22)));
    }
  }
  pruneVisuals(now);
  return { view: v, shipPos, mapRadiusPx };
}

// ---- expedition ------------------------------------------------------------------

function nearestOf<T extends { hex: Hex }>(list: T[], from: Hex, range: number): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const x of list) {
    const d = hexDistance(x.hex, from);
    if (d <= range && d < bestD) {
      best = x;
      bestD = d;
    }
  }
  return best;
}

export function drawExpedition(ctx: CanvasRenderingContext2D, s: GameState, ui: UIState, w: number, h: number, now: number, dt: number): DrawResult {
  const ex = s.expedition!;
  const cam = ui.cams.expedition;
  const v0 = computeView(w, h, CONFIG.expedition.radius, cam);
  const mapRadiusPx = v0.base * (CONFIG.expedition.radius + 1) * 1.6;
  clampCamera(cam, mapRadiusPx);
  const v = computeView(w, h, CONFIG.expedition.radius, cam);
  const z = v.size;
  drawBackground(ctx, w, h, cam.x, cam.y, 'anomaly', '#0b0614');
  drawGrid(ctx, v, ui);

  const g = hexScreen(v, GATE);
  drawGate(ctx, g.x, g.y, z * 0.55, now);

  ex.deposits.forEach((d, i) => {
    const p = hexScreen(v, d.hex);
    drawCrystals(ctx, p.x, p.y, z * 0.45, now, i * 977 + 13, d.shards > 0);
  });

  const ships = expeditionShips(s);
  const shipVis = new Map<string, Visual>();
  for (const sh of ships) shipVis.set(sh.id, animate(`x:${sh.id}`, sh, now, dt, 0.32, 0.5));
  const enemyVis = new Map<string, Visual>();
  for (const en of ex.enemies) enemyVis.set(en.id, animate(`e:${en.id}`, en, now, dt, 0.12, 0.8));

  // beams: wardens fire at the nearest enemy in range, enemies at the nearest ship when adjacent,
  // miners draw shards from the deposit under them
  for (const sh of ships) {
    const sv = toScreen(v, shipVis.get(sh.id)!);
    if (sh.type === 'warden') {
      const target = nearestOf(ex.enemies, sh.hex, 1);
      if (target) {
        const tv = toScreen(v, enemyVis.get(target.id)!);
        drawBeam(ctx, sv.x, sv.y, tv.x, tv.y, '#8fd0ff', Math.max(1.5, z * 0.05), now);
      }
    }
    if (sh.type === 'miner' && !sh.path.length) {
      const dep = ex.deposits.find((d) => hexEq(d.hex, sh.hex) && d.shards > 0);
      if (dep && sh.shards < shipStats(s, 'miner').cargoExp - 1e-6) {
        const dp = hexScreen(v, dep.hex);
        drawBeam(ctx, sv.x, sv.y, dp.x, dp.y, C.shard, Math.max(1, z * 0.04), now);
      }
    }
  }
  for (const en of ex.enemies) {
    if (en.path.length) continue;
    const target = nearestOf(ships, en.hex, 1);
    if (!target) continue;
    const a = toScreen(v, enemyVis.get(en.id)!);
    const b = toScreen(v, shipVis.get(target.id)!);
    drawBeam(ctx, a.x, a.y, b.x, b.y, C.enemy, Math.max(1, z * 0.035), now);
  }

  for (const en of ex.enemies) drawEnemy(ctx, v, en, enemyVis.get(en.id)!, now);

  drawPreview(ctx, v, ui, ships.find((x) => x.id === ui.selShip));
  const shipPos = new Map<string, { x: number; y: number }>();
  const r = Math.max(6, z * 0.19);
  for (const sh of ships) {
    const p = drawShipAt(ctx, s, v, sh, shipVis.get(sh.id)!, r, ui.selShip === sh.id, now, false);
    shipPos.set(sh.id, p);
    if (sh.shards >= 1) label(ctx, `◆ ${Math.floor(sh.shards)}`, p.x, p.y - r * 2.4, C.shard, 11);
  }

  if (z > 20) {
    label(ctx, 'Sprungtor', g.x, g.y + z * 0.62, '#5fd4ff', 11);
    for (const d of ex.deposits) {
      const p = hexScreen(v, d.hex);
      label(ctx, d.shards > 0 ? `${Math.floor(d.shards)}` : 'leer', p.x, p.y + z * 0.55, d.shards > 0 ? C.shard : C.dim, 11);
    }
  }

  // collapse warning
  const left = ex.duration - ex.elapsed;
  if (left < CONFIG.expedition.collapseWarning) {
    const pulse = 0.25 + 0.25 * Math.sin(now / 200);
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(255,40,70,0)');
    vg.addColorStop(1, `rgba(255,40,70,${pulse})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }
  pruneVisuals(now);
  return { view: v, shipPos, mapRadiusPx };
}

function drawEnemy(ctx: CanvasRenderingContext2D, v: View, en: Enemy, vis: Visual, now: number) {
  const p = toScreen(v, vis);
  const r = v.size * (en.type === 'colossus' ? 0.3 : 0.17);
  drawTrail(ctx, v, vis, '#ff5d6c', Math.max(1, r * 0.3));
  drawEnemySprite(ctx, en.type, p.x, p.y, r, now, hashId(en.id) % 7);
  bar(ctx, p.x, p.y + r + 4, r * 2.4, en.hp / en.maxHp, C.enemy);
}
