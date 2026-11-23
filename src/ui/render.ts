// Canvas drawing for the home sector and the expedition map: camera, free flight, effects.
import { CONFIG } from '../game/config';
import { shipStats } from '../game/economy';
import { GATE_POS, depositNear, enemyTarget, expeditionShips, nearest } from '../game/expedition';
import { center, dist } from '../game/geom';
import { hexKey, hexesInRadius } from '../game/hex';
import { nodeById, nodeNear } from '../game/state';
import type { Enemy, GameState, Ship, Vec } from '../game/types';
import { clampCamera, type Camera } from './camera';
import {
  SHIP_COLORS, fogTexture, drawAsteroids, drawBackground, drawBase, drawBeam, drawCrystals, drawEnemySprite, drawGasGiant, drawGate, drawPlanet,
  drawShipSprite, drawStation, hashId,
} from './sprites';
import type { UIState } from './ui-state';

/** World units per hex radius, and object sizes in world units. */
const HEX = CONFIG.hexSize;
const S = {
  planet: 0.8, base: 1.0, station: 0.85, belt: 1.1, ring: 1.5, label: 1.3,
  ship: 0.45, skirmisher: 0.4, colossus: 0.7, crystals: 0.9, gate: 1.2,
};

const C = {
  grid: 'rgba(120,150,220,0.08)',
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
  size: number; // screen pixels per world unit (= hex radius)
  radius: number;
}

export interface DrawResult {
  view: View;
  shipPos: Map<string, { x: number; y: number }>;
  mapRadiusPx: number;
}

export function computeView(w: number, h: number, radius: number, cam: Camera): View & { base: number } {
  const base = (Math.min(w / (Math.sqrt(3) * (2 * radius + 1)), h / (3 * radius + 2)) * 0.96) / HEX;
  return { cx: w / 2 + cam.x, cy: h / 2 + cam.y, size: base * cam.zoom, radius, base };
}

export const toScreen = (v: View, p: Vec) => ({ x: v.cx + p.x * v.size, y: v.cy + p.y * v.size });
export const toWorld = (v: View, x: number, y: number): Vec => ({ x: (x - v.cx) / v.size, y: (y - v.cy) / v.size });

// ---- engine trails (visual only) ------------------------------------------------------

const trails = new Map<string, { pts: Vec[]; seen: number }>();

function trailFor(key: string, pos: Vec, moving: boolean, now: number): Vec[] {
  let t = trails.get(key);
  if (!t) {
    t = { pts: [], seen: now };
    trails.set(key, t);
  }
  const last = t.pts[t.pts.length - 1];
  if (moving && (!last || dist(last, pos) > 0.03)) {
    t.pts.push({ ...pos });
    if (t.pts.length > 30) t.pts.shift();
  } else if (!moving && t.pts.length) {
    t.pts.shift();
  }
  if (last && dist(last, pos) > 3) t.pts = []; // jumped (e.g. through the gate)
  t.seen = now;
  return t.pts;
}

function pruneTrails(now: number) {
  for (const [k, t] of trails) if (now - t.seen > 2000) trails.delete(k);
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

/** Faint hex grid as a sense of scale; fades out when zoomed far out. */
function drawGrid(ctx: CanvasRenderingContext2D, v: View, w: number, h: number) {
  const hs = v.size * HEX; // hex radius on screen
  if (hs < 7) return;
  ctx.lineWidth = 1;
  ctx.strokeStyle = C.grid;
  ctx.globalAlpha = Math.min(1, (hs - 7) / 15);
  for (const hx of hexesInRadius(v.radius)) {
    const p = toScreen(v, center(hx));
    if (p.x < -hs || p.y < -hs || p.x > w + hs || p.y > h + hs) continue;
    hexPath(ctx, p.x, p.y, hs * 0.98);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Outline of the map so the edge of the sector is visible. */
function drawBorder(ctx: CanvasRenderingContext2D, v: View, color: string) {
  const R = (v.radius + 0.5) * HEX;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i);
    const p = toScreen(v, { x: Math.cos(a) * R * Math.sqrt(3), y: Math.sin(a) * R * Math.sqrt(3) });
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
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

function drawTrail(ctx: CanvasRenderingContext2D, v: View, pts: Vec[], head: Vec, color: string, width: number) {
  if (pts.length < 2) return;
  ctx.lineCap = 'round';
  const all = [...pts, head];
  for (let i = 1; i < all.length; i++) {
    const a = toScreen(v, all[i - 1]);
    const b = toScreen(v, all[i]);
    const f = i / all.length;
    ctx.globalAlpha = f * 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * f;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Destination marker and line for ships that are flying somewhere. */
function drawCourse(ctx: CanvasRenderingContext2D, v: View, ship: Ship, selected: boolean, now: number) {
  if (!ship.target) return;
  const a = toScreen(v, ship.pos);
  const b = toScreen(v, ship.target);
  ctx.setLineDash([3, 6]);
  ctx.lineDashOffset = -now / 60;
  ctx.strokeStyle = selected ? 'rgba(255,255,255,0.55)' : SHIP_COLORS[ship.type] + '40';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  if (selected) {
    const r = Math.max(5, v.size * 0.35);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.moveTo(b.x - r, b.y);
    ctx.lineTo(b.x + r, b.y);
    ctx.moveTo(b.x, b.y - r);
    ctx.lineTo(b.x, b.y + r);
    ctx.stroke();
  }
}

/** Dashed line from the selected ship to the mouse: where it would fly on click. */
function drawAim(ctx: CanvasRenderingContext2D, v: View, ui: UIState, ship: Ship | undefined) {
  if (!ship || !ui.hoverPoint) return;
  const a = toScreen(v, ship.pos);
  const b = toScreen(v, ui.hoverPoint);
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(b.x, b.y, Math.max(4, v.size * 0.3), 0, Math.PI * 2);
  ctx.stroke();
}

function drawShip(ctx: CanvasRenderingContext2D, s: GameState, v: View, key: string, ship: Ship, r: number, selected: boolean, now: number) {
  const p = toScreen(v, ship.pos);
  const moving = !!ship.target;
  drawTrail(ctx, v, trailFor(key, ship.pos, moving, now), ship.pos, SHIP_COLORS[ship.type], Math.max(1.5, r * 0.35));
  if (selected) {
    ctx.strokeStyle = C.sel;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawShipSprite(ctx, ship.type, p.x, p.y, ship.heading, r, moving ? 1 : 0, now);
  const st = shipStats(s, ship.type);
  if (selected || ship.hull < st.hull - 1 || ship.shield < st.shield - 1) {
    bar(ctx, p.x, p.y + r * 1.3, r * 2.6, ship.hull / st.hull, C.hull);
    if (st.shield > 0) bar(ctx, p.x, p.y + r * 1.3 + 4, r * 2.6, ship.shield / st.shield, C.shield);
  }
  return p;
}

function setupView(w: number, h: number, radius: number, cam: Camera) {
  const v0 = computeView(w, h, radius, cam);
  const mapRadiusPx = v0.base * HEX * (radius + 1) * 1.8;
  clampCamera(cam, mapRadiusPx);
  return { v: computeView(w, h, radius, cam), mapRadiusPx };
}

const onScreen = (p: { x: number; y: number }, w: number, h: number, m: number) => p.x > -m && p.y > -m && p.x < w + m && p.y < h + m;

/** Black nebula over every unexplored hex; it drifts slowly and moves with the map. */
function drawFog(ctx: CanvasRenderingContext2D, v: View, explored: Set<string>, w: number, h: number, now: number) {
  const hs = v.size * HEX;
  ctx.beginPath();
  let any = false;
  for (const hx of hexesInRadius(v.radius)) {
    if (explored.has(hexKey(hx))) continue;
    const p = toScreen(v, center(hx));
    if (p.x < -hs || p.y < -hs || p.x > w + hs || p.y > h + hs) continue;
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      const px = p.x + hs * 1.01 * Math.cos(a);
      const py = p.y + hs * 1.01 * Math.sin(a);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    any = true;
  }
  if (!any) return;
  const pat = ctx.createPattern(fogTexture(), 'repeat');
  if (pat) {
    const k = Math.max(0.3, hs / 160);
    pat.setTransform(new DOMMatrix().translate(v.cx + now * 0.004 * k, v.cy).scale(k));
    ctx.fillStyle = pat;
  } else {
    ctx.fillStyle = '#030409';
  }
  ctx.fill();
  ctx.strokeStyle = 'rgba(110,80,180,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ---- home sector ------------------------------------------------------------------

export function drawHome(ctx: CanvasRenderingContext2D, s: GameState, ui: UIState, w: number, h: number, now: number): DrawResult {
  const cam = ui.cams.home;
  const { v, mapRadiusPx } = setupView(w, h, CONFIG.sector.radius, cam);
  const z = v.size;
  drawBackground(ctx, w, h, cam.x, cam.y, 'home', '#060a15');
  drawGrid(ctx, v, w, h);
  drawBorder(ctx, v, 'rgba(95,212,255,0.25)');
  const ships = s.ships.filter((x) => x.location === 'home');
  const explored = new Set(s.explored);

  // shuttle routes
  ctx.setLineDash([2, 7]);
  for (const sh of ships) {
    if (!sh.shuttle) continue;
    const a = nodeById(s, sh.shuttle.a);
    const b = nodeById(s, sh.shuttle.b);
    if (!a || !b) continue;
    const pa = toScreen(v, center(a.hex));
    const pb = toScreen(v, center(b.hex));
    ctx.strokeStyle = SHIP_COLORS[sh.type] + '50';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // nodes
  for (const n of s.nodes) {
    if (!explored.has(hexKey(n.hex))) continue;
    const p = toScreen(v, center(n.hex));
    if (!onScreen(p, w, h, z * 3)) continue;
    if (ui.selNode === n.id) {
      ctx.strokeStyle = C.sel;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(12, z * S.ring), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (n.kind === 'base') drawBase(ctx, p.x, p.y, Math.max(6, z * S.base), now);
    else if (n.kind === 'planet') {
      const pr = Math.max(5, z * S.planet);
      drawPlanet(ctx, p.x, p.y, pr, n.id, n.planetType ?? 'rock', n.level > 0);
      if (n.level > 0 && pr > 9) {
        ctx.fillStyle = 'rgba(6,10,21,0.85)';
        ctx.beginPath();
        ctx.arc(p.x + pr * 0.8, p.y - pr * 0.8, Math.max(7, pr * 0.35), 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `600 ${Math.max(9, pr * 0.4)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = n.planetType === 'garden' ? '#5fe0b0' : '#e8a95b';
        ctx.fillText(String(n.level), p.x + pr * 0.8, p.y - pr * 0.78);
      }
    } else if (n.kind === 'station') drawStation(ctx, p.x, p.y, Math.max(6, z * S.station), now, n.stock / CONFIG.station.stockCap, hashId(n.id) % 10);
    else if (n.kind === 'gasgiant') {
      const gr = Math.max(6, z * S.planet * 1.3);
      drawGasGiant(ctx, p.x, p.y, gr, now, hashId(n.id) % 13, n.level > 0);
      if (n.level > 0 && gr > 9) {
        ctx.fillStyle = 'rgba(6,10,21,0.85)';
        ctx.beginPath();
        ctx.arc(p.x + gr * 0.8, p.y - gr * 0.8, Math.max(7, gr * 0.3), 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `600 ${Math.max(9, gr * 0.32)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#4fb3ff';
        ctx.fillText(String(n.level), p.x + gr * 0.8, p.y - gr * 0.78);
      }
    } else if (n.kind === 'asteroid') drawAsteroids(ctx, p.x, p.y, Math.max(6, z * S.belt), now, hashId(n.id), n.ore / CONFIG.asteroid.oreMax);
  }

  // mining beams: a miner parked at a belt with room in its hold
  for (const sh of ships) {
    if (sh.type !== 'miner' || sh.target) continue;
    const n = nodeNear(s, sh.pos);
    if (n?.kind !== 'asteroid' || n.ore < 1 || sh.cargo >= shipStats(s, 'miner').cargoHome - 1e-6) continue;
    const a = toScreen(v, sh.pos);
    const b = toScreen(v, center(n.hex));
    drawBeam(ctx, a.x, a.y, b.x, b.y, C.ore, Math.max(1, z * 0.08), now);
  }

  drawFog(ctx, v, explored, w, h, now);

  const selected = ships.find((x) => x.id === ui.selShip);
  for (const sh of ships) drawCourse(ctx, v, sh, sh === selected, now);
  drawAim(ctx, v, ui, selected);
  const shipPos = new Map<string, { x: number; y: number }>();
  const r = Math.max(4, z * S.ship);
  for (const sh of ships) shipPos.set(sh.id, drawShip(ctx, s, v, `h:${sh.id}`, sh, r, sh === selected, now));

  if (z * S.planet > 8) {
    for (const n of s.nodes) {
      if (!explored.has(hexKey(n.hex))) continue;
      const p = toScreen(v, center(n.hex));
      if (!onScreen(p, w, h, 60)) continue;
      label(ctx, n.name, p.x, p.y + z * S.label, ui.selNode === n.id ? C.text : C.dim, Math.max(10, Math.min(13, z * 0.4)));
    }
  }
  pruneTrails(now);
  return { view: v, shipPos, mapRadiusPx };
}

// ---- expedition ------------------------------------------------------------------

export function drawExpedition(ctx: CanvasRenderingContext2D, s: GameState, ui: UIState, w: number, h: number, now: number): DrawResult {
  const ex = s.expedition!;
  const cam = ui.cams.expedition;
  const { v, mapRadiusPx } = setupView(w, h, CONFIG.expedition.radius, cam);
  const z = v.size;
  drawBackground(ctx, w, h, cam.x, cam.y, 'anomaly', '#0b0614');
  drawGrid(ctx, v, w, h);
  drawBorder(ctx, v, 'rgba(255,93,108,0.3)');

  const g = toScreen(v, GATE_POS);
  drawGate(ctx, g.x, g.y, Math.max(8, z * S.gate), now);

  ex.deposits.forEach((d, i) => {
    const p = toScreen(v, center(d.hex));
    if (onScreen(p, w, h, z * 2)) drawCrystals(ctx, p.x, p.y, Math.max(5, z * S.crystals), now, i * 977 + 13, d.shards > 0);
  });

  const ships = expeditionShips(s);

  // beams: wardens fire at the nearest enemy in range, enemies at the nearest ship in range,
  // miners draw shards from the deposit they are parked at
  for (const sh of ships) {
    const sv = toScreen(v, sh.pos);
    if (sh.type === 'warden') {
      const target = nearest(ex.enemies, sh.pos, CONFIG.ranges.weapon);
      if (target) {
        const tv = toScreen(v, target.pos);
        drawBeam(ctx, sv.x, sv.y, tv.x, tv.y, '#8fd0ff', Math.max(1.5, z * 0.1), now);
      }
    }
    if (sh.type === 'miner' && !sh.target) {
      const dep = depositNear(ex, sh.pos);
      if (dep && sh.shards < shipStats(s, 'miner').cargoExp - 1e-6) {
        const dp = toScreen(v, center(dep.hex));
        drawBeam(ctx, sv.x, sv.y, dp.x, dp.y, C.shard, Math.max(1, z * 0.08), now);
      }
    }
  }
  for (const en of ex.enemies) {
    if (en.target) continue;
    const target = enemyTarget(en.pos, ships, ships.filter((x) => x.type === 'warden'));
    if (!target || dist(target.pos, en.pos) > CONFIG.ranges.enemyAttack) continue;
    const a = toScreen(v, en.pos);
    const b = toScreen(v, target.pos);
    drawBeam(ctx, a.x, a.y, b.x, b.y, C.enemy, Math.max(1, z * 0.07), now);
  }

  for (const en of ex.enemies) drawEnemy(ctx, v, en, now);

  const selected = ships.find((x) => x.id === ui.selShip);
  for (const sh of ships) drawCourse(ctx, v, sh, sh === selected, now);
  drawAim(ctx, v, ui, selected);
  const shipPos = new Map<string, { x: number; y: number }>();
  const r = Math.max(5, z * S.ship * 1.1);
  for (const sh of ships) {
    const p = drawShip(ctx, s, v, `x:${sh.id}`, sh, r, sh === selected, now);
    shipPos.set(sh.id, p);
    if (sh.shards >= 1) label(ctx, `◆ ${Math.floor(sh.shards)}`, p.x, p.y - r * 2.4, C.shard, 11);
  }

  if (z * S.planet > 8) {
    label(ctx, 'Sprungtor', g.x, g.y + z * S.label, '#5fd4ff', 11);
    for (const d of ex.deposits) {
      const p = toScreen(v, center(d.hex));
      if (!onScreen(p, w, h, 60)) continue;
      label(ctx, d.shards > 0 ? `${Math.floor(d.shards)}` : 'leer', p.x, p.y + z * S.label, d.shards > 0 ? C.shard : C.dim, 11);
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
  pruneTrails(now);
  return { view: v, shipPos, mapRadiusPx };
}

function drawEnemy(ctx: CanvasRenderingContext2D, v: View, en: Enemy, now: number) {
  const p = toScreen(v, en.pos);
  const r = Math.max(4, v.size * (en.type === 'colossus' ? S.colossus : S.skirmisher));
  drawTrail(ctx, v, trailFor(`e:${en.id}`, en.pos, !!en.target, now), en.pos, '#ff5d6c', Math.max(1, r * 0.3));
  drawEnemySprite(ctx, en.type, p.x, p.y, r, now, hashId(en.id) % 7);
  bar(ctx, p.x, p.y + r + 4, r * 2.4, en.hp / en.maxHp, C.enemy);
}
