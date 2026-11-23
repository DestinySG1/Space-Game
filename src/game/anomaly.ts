// Co-op anomaly engine: one shared, timed system with ships from several players.
// Pure logic without DOM or network, used by the server (authoritative) and by the client for types.
import { CONFIG, MODULES, moduleInfo } from './config';
import { shipStats, type ShipStats } from './economy';
import { center, dist, fly, insideMap, parkingSpot } from './geom';
import { hex, hexDistance, hexesInRadius } from './hex';
import type { Deposit, Enemy, EnemyType, GameState, ModuleId, Ship, ShipType, SlotType, Vec } from './types';

export const MAX_PLAYERS = 4;
export const GATE_POS: Vec = { x: 0, y: 0 };

/** What a client sends about one of its ships; the server computes the stats itself. */
export interface ShipOffer {
  id: string;
  type: ShipType;
  name: string;
  fit: Partial<Record<SlotType, ModuleId>>;
  levels: Partial<Record<ModuleId, number>>; // blueprint levels of the fitted modules
}

export interface RunShip {
  id: string;
  owner: string;
  type: ShipType;
  name: string;
  pos: Vec;
  target: Vec | null;
  heading: number;
  hull: number;
  shield: number;
  lastHit: number;
  shards: number;
  stats: ShipStats;
  active: { id: ModuleId; level: number; cooldown: number } | null;
  readyAt: number;
}

export interface RunPlayer {
  name: string;
  banked: number;
  lost: number;
}

export type RunEvent =
  | { t: 'returned'; owner: string; shipId: string; shards: number; hull: number }
  | { t: 'lost'; owner: string; shipId: string; reason: 'destroyed' | 'collapse' }
  | { t: 'wave'; index: number; count: number }
  | { t: 'end' };

export interface Run {
  id: string;
  tier: number;
  rng: number;
  time: number;
  elapsed: number;
  duration: number;
  deposits: Deposit[];
  enemies: Enemy[];
  nextWave: number;
  waveIndex: number;
  ships: RunShip[];
  players: RunPlayer[];
  events: RunEvent[];
  ended: boolean;
  nextId: number;
}

// ---- deterministic random numbers kept inside the run (mulberry32) ----------------------

function rand(run: Run): number {
  run.rng = (run.rng + 0x6d2b79f5) >>> 0;
  let t = run.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---- setup ----------------------------------------------------------------------------

const clampLevel = (n: unknown) => Math.max(0, Math.min(CONFIG.research.maxLevel, Math.floor(Number(n) || 0)));

/** Stats from type + modules, computed here so a client cannot send inflated numbers. */
export function offerStats(offer: ShipOffer): ShipStats {
  const blueprints = Object.fromEntries(MODULES.map((m) => [m.id, clampLevel(offer.levels[m.id])])) as GameState['blueprints'];
  const fit: Ship['fit'] = {};
  for (const [slot, id] of Object.entries(offer.fit ?? {}) as [SlotType, ModuleId][]) {
    if (MODULES.some((m) => m.id === id && m.slot === slot)) fit[slot] = id;
  }
  return shipStats({ blueprints } as GameState, offer.type, { fit } as Ship);
}

export function createRun(id: string, tier: number, seed: number, playerCount: number): Run {
  const run: Run = {
    id,
    tier,
    rng: seed >>> 0,
    time: 0,
    elapsed: 0,
    duration: CONFIG.expedition.duration,
    deposits: [],
    enemies: [],
    nextWave: CONFIG.expedition.firstWave,
    waveIndex: 0,
    ships: [],
    players: [],
    events: [],
    ended: false,
    nextId: 1,
  };
  const e = CONFIG.expedition;
  const spots = hexesInRadius(e.radius).filter((h) => hexDistance(h, hex(0, 0)) >= 2);
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(rand(run) * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  const count = e.depositsBase + tier + 5 * (playerCount - 1); // more players, more to find
  for (const h of spots) {
    if (run.deposits.length >= count) break;
    if (run.deposits.some((d) => hexDistance(d.hex, h) < 2)) continue;
    const base = e.depositShardsMin + Math.floor(rand(run) * (e.depositShardsMax - e.depositShardsMin + 1));
    run.deposits.push({ hex: h, shards: Math.round(base * tier ** e.depositTierExponent) });
  }
  return run;
}

/** A player brings ships into the run (before or after the start). */
export function joinRun(run: Run, owner: string, offers: ShipOffer[]): RunShip[] {
  if (!run.players.some((p) => p.name === owner)) run.players.push({ name: owner, banked: 0, lost: 0 });
  // every player arrives on their own side of the gate, ships fanned out a little
  const side = run.players.findIndex((p) => p.name === owner) * (Math.PI / 2) + Math.PI / 4;
  const added: RunShip[] = [];
  for (const [i, o] of offers.slice(0, CONFIG.expedition.maxShips).entries()) {
    if (!(o.type in CONFIG.ships) || run.ships.some((x) => x.id === o.id && x.owner === owner)) continue;
    const stats = offerStats(o);
    const supportId = o.fit?.support;
    const lvl = supportId ? clampLevel(o.levels[supportId]) : 0;
    const active =
      supportId && moduleInfo(supportId)?.cooldown && lvl > 0
        ? { id: supportId, level: lvl, cooldown: supportId === 'blink' ? Math.max(30, 150 - 15 * (lvl - 1)) : moduleInfo(supportId).cooldown! }
        : null;
    const ship: RunShip = {
      id: o.id,
      owner,
      type: o.type,
      name: String(o.name ?? '').slice(0, 24) || 'Schiff',
      pos: { x: Math.cos(side + (i - 1.5) * 0.3) * 3, y: Math.sin(side + (i - 1.5) * 0.3) * 3 },
      target: null,
      heading: -Math.PI / 2,
      hull: stats.hull,
      shield: stats.shield,
      lastHit: -999,
      shards: 0,
      stats,
      active,
      readyAt: 0,
    };
    run.ships.push(ship);
    added.push(ship);
  }
  return added;
}

// ---- commands -------------------------------------------------------------------------

const own = (run: Run, owner: string, shipId: string) => run.ships.find((x) => x.id === shipId && x.owner === owner);

export function moveShip(run: Run, owner: string, shipId: string, to: Vec): boolean {
  const ship = own(run, owner, shipId);
  if (!ship || run.ended || !Number.isFinite(to?.x) || !Number.isFinite(to?.y) || !insideMap(to, CONFIG.expedition.radius)) return false;
  ship.target = { x: to.x, y: to.y };
  return true;
}

/** Where a co-op ship waits next to the gate (the same spot the server uses). */
export const coopGateSpot = (owner: string, shipId: string) => parkingSpot(GATE_POS, `${owner}/${shipId}`, CONFIG.ranges.park);

export const canJumpRun = (ship: RunShip) => !ship.target && dist(ship.pos, GATE_POS) <= CONFIG.ranges.gate;

export function jumpShip(run: Run, owner: string, shipId: string): boolean {
  const ship = own(run, owner, shipId);
  if (!ship || !canJumpRun(ship)) return false;
  const shards = Math.floor(ship.shards);
  const player = run.players.find((p) => p.name === owner)!;
  player.banked += shards;
  run.ships = run.ships.filter((x) => x !== ship);
  run.events.push({ t: 'returned', owner, shipId, shards, hull: ship.hull });
  return true;
}

export function useAbility(run: Run, owner: string, shipId: string): boolean {
  const ship = own(run, owner, shipId);
  if (!ship || !ship.active || ship.readyAt > run.time) return false;
  ship.readyAt = run.time + ship.active.cooldown;
  if (ship.active.id === 'pulse') {
    const until = run.time + CONFIG.expedition.pulseStun + moduleInfo('pulse').perLevel * (ship.active.level - 1);
    for (const en of run.enemies) if (dist(en.pos, ship.pos) <= CONFIG.expedition.pulseRadius) en.stunnedUntil = until;
  } else if (ship.active.id === 'blink') {
    ship.pos = coopGateSpot(owner, ship.id);
    ship.target = null;
  }
  return true;
}

// ---- simulation -----------------------------------------------------------------------

function nearest<T extends { pos: Vec }>(list: T[], from: Vec, range: number): T | undefined {
  let best: T | undefined;
  let bestD = range;
  for (const x of list) {
    const d = dist(x.pos, from);
    if (d <= bestD) {
      best = x;
      bestD = d;
    }
  }
  return best;
}

function spawnWave(run: Run): void {
  const e = CONFIG.expedition;
  run.waveIndex += 1;
  const players = Math.max(1, run.players.length);
  const base = 1 + Math.floor(run.waveIndex / e.extraEnemyEveryWaves) + Math.floor((run.tier - 1) / e.extraEnemyEveryTiers);
  const count = Math.round(base * (1 + 0.6 * (players - 1)));
  const mult = (1 + e.tierStrength * (run.tier - 1)) * (1 + e.timeStrength * (run.elapsed / run.duration));
  const edge = hexesInRadius(e.radius).filter((h) => hexDistance(h, hex(0, 0)) === e.radius);
  const start = Math.floor(rand(run) * edge.length);
  for (let i = 0; i < count; i++) {
    const heavy = run.waveIndex >= CONFIG.enemies.colossus.fromWave && i % 4 === 0 && run.waveIndex % 2 === 1;
    const type: EnemyType = heavy ? 'colossus' : 'skirmisher';
    const def = CONFIG.enemies[type];
    const p = center(edge[(start + i * 2) % edge.length]);
    run.enemies.push({
      id: `e${run.nextId++}`, type, pos: p, target: null, heading: Math.atan2(-p.y, -p.x),
      hp: def.hp * mult, maxHp: def.hp * mult, dps: def.dps * mult, stunnedUntil: 0,
    });
  }
  run.events.push({ t: 'wave', index: run.waveIndex, count });
}

function lose(run: Run, ship: RunShip, reason: 'destroyed' | 'collapse') {
  run.ships = run.ships.filter((x) => x !== ship);
  const p = run.players.find((x) => x.name === ship.owner);
  if (p) p.lost += 1;
  run.events.push({ t: 'lost', owner: ship.owner, shipId: ship.id, reason });
}

export function tickRun(run: Run, dt: number): void {
  if (run.ended) return;
  const R = CONFIG.ranges;
  run.time += dt;
  run.elapsed += dt;
  if (run.elapsed >= run.nextWave && run.elapsed < run.duration) {
    spawnWave(run);
    run.nextWave += CONFIG.expedition.waveInterval;
  }

  for (const ship of run.ships) {
    const st = ship.stats;
    const flying = fly(ship, st.speedExp, dt);
    if (run.time - ship.lastHit > st.shieldDelay) ship.shield = Math.min(st.shield, ship.shield + st.shield * st.shieldRegen * dt);
    if (st.repair > 0) {
      for (const other of run.ships) {
        if (dist(other.pos, ship.pos) <= CONFIG.expedition.droneRadius) other.hull = Math.min(other.stats.hull, other.hull + st.repair * dt);
      }
    }
    if (!flying && st.mineExp > 0) {
      const dep = run.deposits.find((d) => d.shards > 0 && dist(center(d.hex), ship.pos) <= R.dock);
      if (dep) {
        const got = Math.min(st.mineExp * dt, dep.shards, st.cargoExp - ship.shards);
        ship.shards += got;
        dep.shards -= got;
        if (dep.shards < 1e-6) dep.shards = 0;
      }
    }
    if (st.dps > 0) {
      const targets = run.enemies
        .map((en) => ({ en, d: dist(en.pos, ship.pos) }))
        .filter((x) => x.d <= R.weapon)
        .sort((a, b) => a.d - b.d)
        .slice(0, st.targets);
      for (const { en } of targets) en.hp -= st.dps * dt;
    }
  }

  // miners hand shards to a hauler of the same player standing next to them
  for (const miner of run.ships.filter((x) => x.type === 'miner' && x.shards > 0)) {
    for (const hauler of run.ships.filter((x) => x.type === 'hauler' && x.owner === miner.owner && !x.target && dist(x.pos, miner.pos) <= R.transfer)) {
      const moved = Math.min(hauler.stats.cargoExp - hauler.shards, miner.shards);
      hauler.shards += moved;
      miner.shards -= moved;
    }
  }

  run.enemies = run.enemies.filter((en) => en.hp > 0);
  const wardens = run.ships.filter((x) => x.type === 'warden');
  for (const en of run.enemies) {
    if (en.stunnedUntil > run.time) continue;
    const closest = nearest(run.ships, en.pos, Infinity);
    if (!closest) break;
    // a warden of any player close by draws the fire
    const target = closest.type === 'warden' ? closest : nearest(wardens, en.pos, dist(closest.pos, en.pos) + R.taunt) ?? closest;
    const d = dist(en.pos, target.pos);
    if (d <= R.enemyAttack) {
      en.target = null;
      en.heading = Math.atan2(target.pos.y - en.pos.y, target.pos.x - en.pos.x);
      target.lastHit = run.time;
      const absorbed = Math.min(target.shield, en.dps * dt);
      target.shield -= absorbed;
      target.hull -= en.dps * dt - absorbed;
    } else {
      const k = (R.enemyAttack * 0.85) / d;
      en.target = { x: target.pos.x + (en.pos.x - target.pos.x) * k, y: target.pos.y + (en.pos.y - target.pos.y) * k };
      fly(en, CONFIG.enemies[en.type].speed * CONFIG.speed.expedition, dt);
    }
  }

  for (const ship of [...run.ships]) if (ship.hull <= 0) lose(run, ship, 'destroyed');
  if (run.elapsed >= run.duration) {
    for (const ship of [...run.ships]) lose(run, ship, 'collapse');
  }
  if (run.elapsed >= run.duration || (run.ships.length === 0 && run.elapsed > 1)) {
    run.ended = true;
    run.events.push({ t: 'end' });
  }
}

/** Compact copy for clients: rounded numbers, no event queue. */
export function snapshot(run: Run) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const v = (p: Vec | null) => (p ? { x: r2(p.x), y: r2(p.y) } : null);
  return {
    id: run.id,
    tier: run.tier,
    time: r2(run.time),
    elapsed: r2(run.elapsed),
    duration: run.duration,
    waveIndex: run.waveIndex,
    players: run.players,
    deposits: run.deposits.map((d) => ({ hex: d.hex, shards: r2(d.shards) })),
    enemies: run.enemies.map((e) => ({ ...e, pos: v(e.pos)!, target: v(e.target), heading: r2(e.heading), hp: r2(e.hp), maxHp: r2(e.maxHp) })),
    ships: run.ships.map((x) => ({
      ...x, pos: v(x.pos)!, target: v(x.target), heading: r2(x.heading), hull: r2(x.hull), shield: r2(x.shield), shards: r2(x.shards),
    })),
    ended: run.ended,
  };
}
export type RunSnapshot = ReturnType<typeof snapshot>;
