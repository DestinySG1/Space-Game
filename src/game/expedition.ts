// Expeditions: a timed run into an anomaly. Mine shards, survive waves, jump home before it collapses.
import { CONFIG } from './config';
import { bonus, shipStats, unlockThreshold } from './economy';
import { center, dist, fly, parkingSpot } from './geom';
import { hex, hexDistance, hexesInRadius } from './hex';
import { basePos, sendTo } from './home';
import { makeRng } from './rng';
import { log, shipById } from './state';
import type { Deposit, EnemyType, Expedition, GameState, Ship, Vec } from './types';

export const GATE = hex(0, 0);
export const GATE_POS: Vec = { x: 0, y: 0 };

export function createExpedition(s: GameState, tier: number, shipIds: string[], seed: number): Expedition {
  const e = CONFIG.expedition;
  const rng = makeRng(seed);
  const spots = rng.shuffle(hexesInRadius(e.radius).filter((h) => hexDistance(h, GATE) >= 2));
  const count = e.depositsBase + tier;
  const scan = bonus(s, 'scanner');
  const deposits: Deposit[] = [];
  for (const h of spots) {
    if (deposits.length >= count) break;
    if (deposits.some((d) => hexDistance(d.hex, h) < 2)) continue; // keep deposits apart
    deposits.push({
      hex: h,
      shards: Math.round(rng.int(e.depositShardsMin, e.depositShardsMax) * tier ** e.depositTierExponent * scan),
    });
  }
  return {
    tier,
    elapsed: 0,
    duration: e.duration,
    deposits,
    enemies: [],
    nextWave: e.firstWave,
    waveIndex: 0,
    banked: 0,
    lost: 0,
    shipIds: [...shipIds],
  };
}

export function expeditionShips(s: GameState): Ship[] {
  const ex = s.expedition;
  if (!ex) return [];
  return ex.shipIds.map((id) => shipById(s, id)).filter((x): x is Ship => !!x);
}

export const depositNear = (ex: Expedition, p: Vec) =>
  ex.deposits.find((d) => d.shards > 0 && dist(center(d.hex), p) <= CONFIG.ranges.dock);

function enemyMultiplier(ex: Expedition): number {
  const e = CONFIG.expedition;
  return (1 + e.tierStrength * (ex.tier - 1)) * (1 + e.timeStrength * (ex.elapsed / ex.duration));
}

function spawnWave(s: GameState, ex: Expedition): void {
  const e = CONFIG.expedition;
  ex.waveIndex += 1;
  const count = 1 + Math.floor(ex.waveIndex / e.extraEnemyEveryWaves) + Math.floor((ex.tier - 1) / e.extraEnemyEveryTiers);
  const edge = hexesInRadius(e.radius).filter((h) => hexDistance(h, GATE) === e.radius);
  const mult = enemyMultiplier(ex);
  // a wave arrives together from one side of the map
  const start = Math.floor(Math.random() * edge.length);
  for (let i = 0; i < count; i++) {
    const heavy = ex.waveIndex >= CONFIG.enemies.colossus.fromWave && i === 0 && ex.waveIndex % 2 === 1;
    const type: EnemyType = heavy ? 'colossus' : 'skirmisher';
    const def = CONFIG.enemies[type];
    const hp = def.hp * mult;
    const p = center(edge[(start + i) % edge.length]);
    ex.enemies.push({
      id: `e${s.nextId++}`,
      type,
      pos: p,
      target: null,
      heading: Math.atan2(-p.y, -p.x),
      hp,
      maxHp: hp,
      dps: def.dps * mult,
    });
  }
  log(s, `Expedition: Welle ${ex.waveIndex} – ${count} Gegner tauchen am Rand auf.`);
}

function damageShip(s: GameState, ship: Ship, amount: number): void {
  ship.lastHit = s.time;
  const absorbed = Math.min(ship.shield, amount);
  ship.shield -= absorbed;
  ship.hull -= amount - absorbed;
}

export function nearest<T extends { pos: Vec }>(list: T[], from: Vec, range: number): T | undefined {
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

export function tickExpedition(s: GameState, dt: number): void {
  const ex = s.expedition;
  if (!ex) return;
  const R = CONFIG.ranges;
  ex.elapsed += dt;

  if (ex.elapsed >= ex.nextWave && ex.elapsed < ex.duration) {
    spawnWave(s, ex);
    ex.nextWave += CONFIG.expedition.waveInterval;
  }

  const ships = expeditionShips(s);

  // player ships: fly, regenerate shields, mine, fight
  for (const ship of ships) {
    const st = shipStats(s, ship.type);
    const flying = fly(ship, st.speedExp, dt);
    if (s.time - ship.lastHit > CONFIG.shieldRegenDelay) {
      ship.shield = Math.min(st.shield, ship.shield + st.shield * CONFIG.shieldRegenFraction * dt);
    }
    if (!flying && st.mineExp > 0) {
      const dep = depositNear(ex, ship.pos);
      if (dep) {
        const got = Math.min(st.mineExp * dt, dep.shards, st.cargoExp - ship.shards);
        ship.shards += got;
        dep.shards -= got;
        if (dep.shards < 1e-6) dep.shards = 0; // avoid a float remainder keeping it "not empty"
      }
    }
    if (st.dps > 0) {
      const target = nearest(ex.enemies, ship.pos, R.weapon);
      if (target) target.hp -= st.dps * dt;
    }
  }

  // miners hand their shards to a hauler standing next to them
  for (const miner of ships.filter((x) => x.type === 'miner' && x.shards > 0)) {
    for (const hauler of ships.filter((x) => x.type === 'hauler' && !x.target && dist(x.pos, miner.pos) <= R.transfer)) {
      const moved = Math.min(shipStats(s, 'hauler').cargoExp - hauler.shards, miner.shards);
      hauler.shards += moved;
      miner.shards -= moved;
    }
  }

  // enemies: remove the dead, chase the nearest ship, fire when in range
  const before = ex.enemies.length;
  ex.enemies = ex.enemies.filter((en) => en.hp > 0);
  if (ex.enemies.length < before) s.kills += before - ex.enemies.length;
  const wardens = ships.filter((x) => x.type === 'warden');
  for (const en of ex.enemies) {
    const target = enemyTarget(en.pos, ships, wardens);
    if (!target) break;
    const d = dist(en.pos, target.pos);
    if (d <= R.enemyAttack) {
      en.target = null;
      en.heading = Math.atan2(target.pos.y - en.pos.y, target.pos.x - en.pos.x);
      damageShip(s, target, en.dps * dt);
    } else {
      // approach from the side it is coming from and stop just inside firing range
      const k = (R.enemyAttack * 0.85) / d;
      en.target = { x: target.pos.x + (en.pos.x - target.pos.x) * k, y: target.pos.y + (en.pos.y - target.pos.y) * k };
      fly(en, CONFIG.enemies[en.type].speed * CONFIG.speed.expedition, dt);
    }
  }

  // destroyed ships are lost together with their cargo
  for (const ship of ships) {
    if (ship.hull <= 0) {
      log(s, `Expedition: ${ship.name} wurde zerstört. ${Math.floor(ship.shards)} Splitter verloren.`);
      removeShip(s, ship);
      ex.lost += 1;
    }
  }

  if (ex.elapsed >= ex.duration) {
    for (const ship of expeditionShips(s)) {
      log(s, `Expedition: Die Anomalie kollabiert – ${ship.name} ist verloren.`);
      removeShip(s, ship);
      ex.lost += 1;
    }
  }
  if (ex.shipIds.length === 0) finishExpedition(s);
}

/** Nearest ship, but a warden close by draws the fire instead (it protects the fleet). */
export function enemyTarget(from: Vec, ships: Ship[], wardens: Ship[]): Ship | undefined {
  const closest = nearest(ships, from, Infinity);
  if (!closest || closest.type === 'warden') return closest;
  const guard = nearest(wardens, from, dist(closest.pos, from) + CONFIG.ranges.taunt);
  return guard ?? closest;
}

function removeShip(s: GameState, ship: Ship): void {
  s.ships = s.ships.filter((x) => x.id !== ship.id);
  if (s.expedition) s.expedition.shipIds = s.expedition.shipIds.filter((id) => id !== ship.id);
}

/** Each ship's own spot next to the gate. */
export const gateSpot = (ship: Ship) => parkingSpot(GATE_POS, ship.id, 0.45);

export function canJump(ship: Ship): boolean {
  return ship.location === 'expedition' && !ship.target && dist(ship.pos, GATE_POS) <= CONFIG.ranges.gate;
}

/** Jump a ship home through the gate; its shards are banked. */
export function jumpHome(s: GameState, ship: Ship): boolean {
  const ex = s.expedition;
  if (!ex || !canJump(ship)) return false;
  const shards = Math.floor(ship.shards);
  s.shards += shards;
  ex.banked += shards;
  ship.shards = 0;
  ship.location = 'home';
  ship.pos = parkingSpot(basePos(s), ship.id, CONFIG.ranges.park);
  ship.target = null;
  ship.shuttle = null;
  ex.shipIds = ex.shipIds.filter((id) => id !== ship.id);
  log(s, `Expedition: ${ship.name} ist zurück und bringt ${shards} Splitter mit.`);
  if (ex.shipIds.length === 0) finishExpedition(s);
  return true;
}

function finishExpedition(s: GameState): void {
  const ex = s.expedition;
  if (!ex) return;
  const unlocked = ex.tier === s.maxTier && ex.banked >= unlockThreshold(ex.tier);
  if (unlocked) s.maxTier += 1;
  s.lastResult = { tier: ex.tier, banked: ex.banked, shipsLost: ex.lost, unlocked };
  log(
    s,
    `Expedition Stufe ${ex.tier} beendet: ${ex.banked} Splitter gesichert, ${ex.lost} Schiff(e) verloren.` +
      (unlocked ? ` Stufe ${s.maxTier} freigeschaltet!` : ''),
  );
  s.expedition = null;
}

export { sendTo };
