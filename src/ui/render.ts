// Canvas drawing for the home sector and the expedition map.
import { CONFIG } from '../game/config';
import { shipStats } from '../game/economy';
import { GATE, expeditionShips } from '../game/expedition';
import { hexEq, hexLine, hexToPixel, hexesInRadius } from '../game/hex';
import { nodeById } from '../game/state';
import type { GameState, Hex, Ship } from '../game/types';
import type { UIState } from './ui-state';

export const COLORS = {
  bg: '#070b16',
  grid: 'rgba(120,150,220,0.10)',
  gridHover: 'rgba(140,180,255,0.18)',
  sel: '#ffffff',
  base: '#5fd4ff',
  garden: '#5fe0b0',
  rock: '#e8a95b',
  station: '#b48cff',
  asteroid: '#8c94a8',
  hauler: '#f5c15c',
  miner: '#7ee0a1',
  warden: '#6fb6ff',
  enemy: '#ff5d6c',
  shard: '#ff7bf2',
  text: '#dbe4ff',
  dim: '#6b7799',
  hull: '#7ee0a1',
  shield: '#6fb6ff',
};

export interface View {
  cx: number;
  cy: number;
  size: number;
  radius: number;
}

export function computeView(w: number, h: number, radius: number): View {
  const size = Math.min(w / (Math.sqrt(3) * (2 * radius + 1)), h / (3 * radius + 2)) * 0.96;
  return { cx: w / 2, cy: h / 2, size, radius };
}

const toPx = (v: View, h: Hex) => {
  const p = hexToPixel(h, v.size);
  return { x: v.cx + p.x, y: v.cy + p.y };
};

/** Pixel position of something moving along a path. */
function moverPx(v: View, m: { hex: Hex; path: Hex[]; progress: number }) {
  const a = toPx(v, m.hex);
  if (m.path.length === 0) return { ...a, angle: -Math.PI / 2 };
  const b = toPx(v, m.path[0]);
  return { x: a.x + (b.x - a.x) * m.progress, y: a.y + (b.y - a.y) * m.progress, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

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

let starCache: { w: number; h: number; stars: [number, number, number][] } | null = null;
function drawStars(ctx: CanvasRenderingContext2D, w: number, h: number) {
  if (!starCache || starCache.w !== w || starCache.h !== h) {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const stars: [number, number, number][] = [];
    for (let i = 0; i < (w * h) / 2500; i++) stars.push([rnd() * w, rnd() * h, rnd()]);
    starCache = { w, h, stars };
  }
  for (const [x, y, b] of starCache.stars) {
    ctx.fillStyle = `rgba(200,215,255,${0.15 + b * 0.5})`;
    ctx.fillRect(x, y, b > 0.9 ? 2 : 1, b > 0.9 ? 2 : 1);
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, v: View, ui: UIState) {
  for (const h of hexesInRadius(v.radius)) {
    const p = toPx(v, h);
    hexPath(ctx, p.x, p.y, v.size * 0.97);
    if (ui.hoverHex && hexEq(ui.hoverHex, h)) {
      ctx.fillStyle = COLORS.gridHover;
      ctx.fill();
    }
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, frac: number, color: string) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - w / 2, y, w, 3);
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, frac)), 3);
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = COLORS.dim, px = 11) {
  ctx.font = `${px}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawShip(ctx: CanvasRenderingContext2D, s: GameState, ship: Ship, x: number, y: number, angle: number, r: number, selected: boolean) {
  const color = COLORS[ship.type];
  ctx.save();
  ctx.translate(x, y);
  if (selected) {
    ctx.strokeStyle = COLORS.sel;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.7, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.rotate(angle + Math.PI / 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  if (ship.type === 'warden') {
    ctx.moveTo(0, -r * 1.2);
    ctx.lineTo(r, r * 0.4);
    ctx.lineTo(r * 0.4, r);
    ctx.lineTo(-r * 0.4, r);
    ctx.lineTo(-r, r * 0.4);
  } else if (ship.type === 'miner') {
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(r * 0.6, r);
    ctx.lineTo(-r * 0.6, r);
    ctx.lineTo(-r, 0);
  } else {
    ctx.rect(-r * 0.7, -r, r * 1.4, r * 2);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const st = shipStats(s, ship.type);
  if (ship.location === 'expedition' || ship.hull < st.hull) {
    bar(ctx, x, y + r * 1.5, r * 3, ship.hull / st.hull, COLORS.hull);
    if (st.shield > 0) bar(ctx, x, y + r * 1.5 + 4, r * 3, ship.shield / st.shield, COLORS.shield);
  }
}

/** Ships in the same hex are spread on a small ring so all stay clickable. */
export function shipPositions(v: View, ships: Ship[]): Map<string, { x: number; y: number; angle: number }> {
  const out = new Map<string, { x: number; y: number; angle: number }>();
  const groups = new Map<string, Ship[]>();
  for (const sh of ships) {
    const key = sh.path.length ? `m${sh.id}` : `${sh.hex.q},${sh.hex.r}`;
    groups.set(key, [...(groups.get(key) ?? []), sh]);
  }
  for (const list of groups.values()) {
    list.forEach((sh, i) => {
      const p = moverPx(v, sh);
      const off = sh.path.length ? 0 : v.size * 0.5;
      const a = (i / Math.max(1, list.length)) * Math.PI * 2 + Math.PI / 4;
      const spread = list.length > 1 || !sh.path.length ? off : 0;
      out.set(sh.id, { x: p.x + Math.cos(a) * spread, y: p.y + Math.sin(a) * spread, angle: p.angle });
    });
  }
  return out;
}

function drawPreview(ctx: CanvasRenderingContext2D, v: View, ui: UIState, ship: Ship | undefined) {
  if (!ship || !ui.hoverHex) return;
  const from = ship.path.length ? ship.path[0] : ship.hex;
  if (hexEq(from, ui.hoverHex)) return;
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const a = toPx(v, from);
  ctx.moveTo(a.x, a.y);
  for (const h of hexLine(from, ui.hoverHex)) {
    const p = toPx(v, h);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawHome(ctx: CanvasRenderingContext2D, s: GameState, ui: UIState, w: number, h: number) {
  const v = computeView(w, h, CONFIG.sector.radius);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);
  drawStars(ctx, w, h);
  drawGrid(ctx, v, ui);
  const z = v.size;
  const ships = s.ships.filter((x) => x.location === 'home');

  // shuttle routes
  ctx.setLineDash([2, 6]);
  for (const sh of ships) {
    if (!sh.shuttle) continue;
    const a = nodeById(s, sh.shuttle.a);
    const b = nodeById(s, sh.shuttle.b);
    if (!a || !b) continue;
    const pa = toPx(v, a.hex);
    const pb = toPx(v, b.hex);
    ctx.strokeStyle = COLORS[sh.type] + '66';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const n of s.nodes) {
    const p = toPx(v, n.hex);
    const selected = ui.selNode === n.id;
    if (selected) {
      hexPath(ctx, p.x, p.y, z * 0.97);
      ctx.strokeStyle = COLORS.sel;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (n.kind === 'base') {
      for (const [rr, al] of [[0.42, 1], [0.6, 0.5]] as const) {
        ctx.strokeStyle = COLORS.base;
        ctx.globalAlpha = al;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, z * rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.base;
      ctx.beginPath();
      ctx.arc(p.x, p.y, z * 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else if (n.kind === 'planet') {
      const col = n.planetType === 'garden' ? COLORS.garden : COLORS.rock;
      ctx.beginPath();
      ctx.arc(p.x, p.y, z * 0.38, 0, Math.PI * 2);
      if (n.level > 0) {
        const g = ctx.createRadialGradient(p.x - z * 0.12, p.y - z * 0.12, z * 0.05, p.x, p.y, z * 0.4);
        g.addColorStop(0, col);
        g.addColorStop(1, col + '44');
        ctx.fillStyle = g;
        ctx.fill();
        label(ctx, String(n.level), p.x, p.y - 7, '#06101e', 13);
      } else {
        ctx.strokeStyle = col + '88';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (n.kind === 'station') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = COLORS.station;
      ctx.lineWidth = 2;
      ctx.strokeRect(-z * 0.26, -z * 0.26, z * 0.52, z * 0.52);
      ctx.restore();
      bar(ctx, p.x, p.y + z * 0.45, z * 0.8, n.stock / CONFIG.station.stockCap, COLORS.station);
    } else if (n.kind === 'asteroid') {
      ctx.fillStyle = COLORS.asteroid;
      for (const [dx, dy, r] of [[-0.2, -0.1, 0.12], [0.15, -0.18, 0.09], [0.05, 0.14, 0.14], [0.25, 0.1, 0.07], [-0.22, 0.18, 0.08]]) {
        ctx.beginPath();
        ctx.arc(p.x + dx * z, p.y + dy * z, r * z, 0, Math.PI * 2);
        ctx.fill();
      }
      bar(ctx, p.x, p.y + z * 0.45, z * 0.8, n.ore / CONFIG.asteroid.oreMax, COLORS.rock);
    }
    label(ctx, n.name, p.x, p.y + z * 0.56, selected ? COLORS.text : COLORS.dim, Math.max(9, Math.min(12, z * 0.28)));
  }

  drawPreview(ctx, v, ui, ships.find((x) => x.id === ui.selShip));
  const pos = shipPositions(v, ships);
  for (const sh of ships) {
    const p = pos.get(sh.id)!;
    drawShip(ctx, s, sh, p.x, p.y, p.angle, Math.max(4, z * 0.14), ui.selShip === sh.id);
  }
  return { view: v, shipPos: pos };
}

export function drawExpedition(ctx: CanvasRenderingContext2D, s: GameState, ui: UIState, w: number, h: number, now: number) {
  const v = computeView(w, h, CONFIG.expedition.radius);
  const ex = s.expedition!;
  ctx.fillStyle = '#0b0714';
  ctx.fillRect(0, 0, w, h);
  drawStars(ctx, w, h);
  drawGrid(ctx, v, ui);
  const z = v.size;

  // the gate
  const g = toPx(v, GATE);
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.rotate(now / 1500);
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = `rgba(95,212,255,${0.9 - i * 0.25})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, z * (0.25 + i * 0.13), i, i + Math.PI * 1.3);
    ctx.stroke();
  }
  ctx.restore();
  label(ctx, 'Sprungtor', g.x, g.y + z * 0.56, COLORS.base, 11);

  for (const d of ex.deposits) {
    const p = toPx(v, d.hex);
    const alpha = d.shards > 0 ? 1 : 0.2;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = COLORS.shard;
    for (const [dx, dy, s2] of [[0, -0.05, 0.3], [-0.16, 0.08, 0.2], [0.15, 0.1, 0.22]]) {
      ctx.beginPath();
      ctx.moveTo(p.x + dx * z, p.y + (dy - s2) * z);
      ctx.lineTo(p.x + (dx + s2 * 0.4) * z, p.y + dy * z);
      ctx.lineTo(p.x + dx * z, p.y + (dy + s2 * 0.6) * z);
      ctx.lineTo(p.x + (dx - s2 * 0.4) * z, p.y + dy * z);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    label(ctx, d.shards > 0 ? `${Math.floor(d.shards)}` : 'leer', p.x, p.y + z * 0.5, d.shards > 0 ? COLORS.shard : COLORS.dim, 11);
  }

  for (const en of ex.enemies) {
    const p = moverPx(v, en);
    const r = z * (en.type === 'colossus' ? 0.26 : 0.15);
    ctx.fillStyle = COLORS.enemy;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - r);
    ctx.lineTo(p.x + r, p.y);
    ctx.lineTo(p.x, p.y + r);
    ctx.lineTo(p.x - r, p.y);
    ctx.closePath();
    ctx.fill();
    bar(ctx, p.x, p.y + r + 3, r * 2.4, en.hp / en.maxHp, COLORS.enemy);
  }

  const ships = expeditionShips(s);
  drawPreview(ctx, v, ui, ships.find((x) => x.id === ui.selShip));
  const pos = shipPositions(v, ships);
  for (const sh of ships) {
    const p = pos.get(sh.id)!;
    drawShip(ctx, s, sh, p.x, p.y, p.angle, Math.max(5, z * 0.16), ui.selShip === sh.id);
    if (sh.shards >= 1) label(ctx, `◆${Math.floor(sh.shards)}`, p.x, p.y - z * 0.5, COLORS.shard, 10);
  }

  // collapse warning
  const left = ex.duration - ex.elapsed;
  if (left < CONFIG.expedition.collapseWarning) {
    const pulse = 0.25 + 0.25 * Math.sin(now / 200);
    ctx.strokeStyle = `rgba(255,93,108,${pulse})`;
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, w - 10, h - 10);
  }
  return { view: v, shipPos: pos };
}
