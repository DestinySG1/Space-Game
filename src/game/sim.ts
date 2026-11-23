import { CONFIG } from './config';
import { tickExpedition } from './expedition';
import { tickHome } from './home';
import { emptyBlueprints, newGame } from './state';
import type { GameState, ModuleId } from './types';

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
      const s = migrate(JSON.parse(raw));
      if (s && s.version === CONFIG.saveVersion) {
        const offline = simulateOffline(s, (Date.now() - s.savedAt) / 1000);
        return { state: s, offline };
      }
    }
  } catch {
    // corrupt or blocked storage: start fresh
  }
  return { state: newGame(), offline: 0 };
}

/** Old research levels (save version 4) become module blueprints; ships get matching modules. */
const OLD_TO_NEW: Record<string, ModuleId> = {
  cargoBay: 'cargo', tradeLink: 'broker', drillHead: 'drill', engines: 'thrusters',
  armor: 'plating', shields: 'deflector', cannons: 'lance',
};

export function migrate(raw: any): GameState | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.version === 4) {
    const bp = emptyBlueprints();
    for (const [oldId, lvl] of Object.entries(raw.modules ?? {})) if (OLD_TO_NEW[oldId]) bp[OLD_TO_NEW[oldId]] = Number(lvl) || 0;
    raw.blueprints = bp;
    delete raw.modules;
    const has = (id: ModuleId) => bp[id] > 0;
    for (const ship of raw.ships ?? []) {
      ship.cooldowns = {};
      ship.fit = {};
      if (has('deflector')) ship.fit.shield = 'deflector';
      else if (has('plating')) ship.fit.shield = 'plating';
      if (ship.type === 'hauler' && (has('broker') || has('cargo'))) ship.fit.trade = has('broker') ? 'broker' : 'cargo';
      if (ship.type === 'miner' && has('drill')) ship.fit.mining = 'drill';
      if (ship.type === 'warden' && has('lance')) ship.fit.weapon = 'lance';
      if (ship.type === 'warden' && has('thrusters')) ship.fit.support = 'thrusters';
    }
    for (const en of raw.expedition?.enemies ?? []) en.stunnedUntil = 0;
    const q = raw.queue?.research;
    if (q) {
      if (OLD_TO_NEW[q.target]) q.target = OLD_TO_NEW[q.target];
      else raw.queue.research = null;
    }
    raw.version = 5;
  }
  return raw as GameState;
}

export function save(s: GameState, storage: Pick<Storage, 'setItem'> | null): void {
  s.savedAt = Date.now();
  try {
    storage?.setItem(CONFIG.saveKey, JSON.stringify(s));
  } catch {
    // storage unavailable (private mode): the game keeps running without saving
  }
}
