// Continuous positions. World units: a hex has radius CONFIG.hexSize.
import { CONFIG } from './config';
import { hexDistance, hexToPixel, pixelToHex } from './hex';
import type { Hex, Vec } from './types';

export const center = (h: Hex): Vec => hexToPixel(h, CONFIG.hexSize);
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const HEX_STEP = Math.sqrt(3) * CONFIG.hexSize; // distance between neighbouring hex centres

export function insideMap(p: Vec, radius: number): boolean {
  return hexDistance(pixelToHex(p.x, p.y, CONFIG.hexSize), { q: 0, r: 0 }) <= radius;
}

/** Pull a point back onto the map along the line to the centre. */
export function clampToMap(p: Vec, radius: number): Vec {
  let q = { ...p };
  for (let i = 0; i < 40 && !insideMap(q, radius); i++) q = { x: q.x * 0.97, y: q.y * 0.97 };
  return q;
}

/** A spot around a point, picked from an id so each ship always parks in its own place. */
export function parkingSpot(around: Vec, id: string, radius: number): Vec {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const a = ((h >>> 0) % 360) * (Math.PI / 180);
  return { x: around.x + Math.cos(a) * radius, y: around.y + Math.sin(a) * radius };
}

export interface Movable {
  pos: Vec;
  target: Vec | null;
  heading: number;
}

/** Fly straight toward the target. Returns true while still flying. */
export function fly(m: Movable, speed: number, dt: number): boolean {
  if (!m.target) return false;
  const dx = m.target.x - m.pos.x;
  const dy = m.target.y - m.pos.y;
  const d = Math.hypot(dx, dy);
  const step = speed * dt;
  if (d > 1e-9) m.heading = Math.atan2(dy, dx);
  if (step >= d) {
    m.pos = { ...m.target };
    m.target = null;
    return false;
  }
  m.pos = { x: m.pos.x + (dx / d) * step, y: m.pos.y + (dy / d) * step };
  return true;
}
