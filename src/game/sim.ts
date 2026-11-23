import { CONFIG } from './config';
import { tickExpedition } from './expedition';
import { tickHome } from './home';
import { newGame } from './state';
import type { GameState } from './types';

/** Advance the whole game by dt seconds in fixed steps. */
export function step(s: GameState, dt: number): void {
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(CONFIG.tick, left);
    s.time += h;
    tickHome(s, h);
    tickExpedition(s, h);
    left -= h;
  }
}

/**
 * Progress while the game was closed: the home sector keeps working (colonies, shuttles, queues),
 * a running expedition is paused so nobody loses ships while away.
 */
export function simulateOffline(s: GameState, seconds: number): number {
  const total = Math.max(0, Math.min(seconds, CONFIG.offlineCapSeconds));
  let left = total;
  while (left > 0) {
    const h = Math.min(1, left);
    s.time += h;
    tickHome(s, h);
    left -= h;
  }
  return total;
}

export function load(storage: Pick<Storage, 'getItem'> | null): { state: GameState; offline: number } {
  try {
    const raw = storage?.getItem(CONFIG.saveKey);
    if (raw) {
      const s = JSON.parse(raw) as GameState;
      if (s.version === CONFIG.saveVersion) {
        const offline = simulateOffline(s, (Date.now() - s.savedAt) / 1000);
        return { state: s, offline };
      }
    }
  } catch {
    // corrupt or blocked storage: start fresh
  }
  return { state: newGame(), offline: 0 };
}

export function save(s: GameState, storage: Pick<Storage, 'setItem'> | null): void {
  s.savedAt = Date.now();
  try {
    storage?.setItem(CONFIG.saveKey, JSON.stringify(s));
  } catch {
    // storage unavailable (private mode): the game keeps running without saving
  }
}
