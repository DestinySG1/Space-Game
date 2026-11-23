// Turns the latest co-op snapshot into drawable data, moving things forward between snapshots
// (the server sends 5 per second; the screen draws 60).
import { CONFIG } from '../game/config';
import type { Vec } from '../game/types';
import type { CoopView } from '../net/coop';
import type { AnomalyData } from './render';

function ahead(pos: Vec, target: Vec | null, step: number): Vec {
  if (!target) return pos;
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const d = Math.hypot(dx, dy);
  if (d <= step || d < 1e-9) return { ...target };
  return { x: pos.x + (dx / d) * step, y: pos.y + (dy / d) * step };
}

export function coopData(view: CoopView, now: number): AnomalyData | null {
  const snap = view.snap;
  if (!snap) return null;
  const dt = Math.max(0, Math.min(0.5, (now - view.snapAt) / 1000));
  const time = snap.time + dt;
  return {
    deposits: snap.deposits,
    enemies: snap.enemies.map((e) => ({
      ...e,
      pos: e.stunnedUntil > time ? e.pos : ahead(e.pos, e.target, CONFIG.enemies[e.type].speed * CONFIG.speed.expedition * dt),
    })),
    ships: snap.ships.map((sh) => ({ ...sh, pos: ahead(sh.pos, sh.target, sh.stats.speedExp * dt), mine: sh.owner === view.me })),
    elapsed: snap.elapsed + dt,
    duration: snap.duration,
    time,
  };
}
