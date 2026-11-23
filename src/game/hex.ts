// Axial hex coordinates, pointy-top layout.
import type { Hex } from './types';

export const hex = (q: number, r: number): Hex => ({ q, r });
export const hexEq = (a: Hex, b: Hex) => a.q === b.q && a.r === b.r;
export const hexKey = (h: Hex) => `${h.q},${h.r}`;

export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function hexRound(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq + 0, r: rr + 0 };
}

/** Hexes from a (exclusive) to b (inclusive) on a straight line. */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const n = hexDistance(a, b);
  const out: Hex[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    // tiny nudge avoids ties landing exactly between two hexes
    out.push(hexRound(a.q + (b.q - a.q) * t + 1e-6, a.r + (b.r - a.r) * t + 1e-6));
  }
  return out;
}

export function hexesInRadius(radius: number): Hex[] {
  const out: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      out.push({ q, r });
    }
  }
  return out;
}

export function hexToPixel(h: Hex, size: number): { x: number; y: number } {
  return { x: size * Math.sqrt(3) * (h.q + h.r / 2), y: size * 1.5 * h.r };
}

export function pixelToHex(x: number, y: number, size: number): Hex {
  const q = ((Math.sqrt(3) / 3) * x - y / 3) / size;
  const r = ((2 / 3) * y) / size;
  return hexRound(q, r);
}
