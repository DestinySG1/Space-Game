// Expeditions: a timed run into an anomaly. Mine shards, survive waves, jump home before it collapses.
import { CONFIG } from './config';
import { bonus, shipStats, unlockThreshold } from './economy';
import { hex, hexDistance, hexEq, hexesInRadius, hexLine } from './hex';
import { advance, baseHex, sendTo } from './home';
import { makeRng } from './rng';
import { log, shipById } from './state';
import type { Enemy, EnemyType, Expedition, GameState, Ship } from './types';

export const GATE = hex(0, 0);

export function createExpedition(s: GameState, tier: number, shipIds: string[], seed: number): Expedition {
  const e = CONFIG.expedition;
  const rng = makeRng(seed);
  const spots = rng.shuffle(hexesInRadius(e.radius).filter((h) => hexDistance(h, GATE) >= 2));
  const count = e.depositsBase + tier;
  const scan = bonus(s, 'scanner');
  const deposits = spots.slice(0, count).map((h) => ({
    hex: h,
    shards: Math.round(rng.int(e.depositShardsMin, e.depositShardsMax) * tier ** e.depositTierExponent * scan),
  }));
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

function enemyMultiplier(ex: Expedition): number {
  const e = CONFIG.expedition;
  return (1 + e.tierStrength * (ex.tier - 1)) * (1 + e.timeStrength * (ex.elapsed / ex.duration));
}

function spawnWave(s: GameState, ex: Expedition): void {
  ex.waveIndex += 1;
  const e = CONFIG.expedition;
  const count = 1 + Math.floor(ex.waveIndex / e.extraEnemyEveryWaves) + Math.floor((ex.tier - 1) / e.extraEnemyEveryTiers);
  const edge = hexesInRadius(CONFIG.expedition.radius).filter((h) => hexDistance(h, GATE) === CONFIG.expedition.radius);
  const mult = enemyMultiplier(ex);
  for (let i = 0; i < count; i++) {
    const heavy = ex.waveIndex >= CONFIG.enemies.colossus.fromWave && i === 0 && ex.waveIndex % 2 === 1;
    const type: EnemyType = heavy ? 'colossus' : 'skirmisher';
    const def = CONFIG.enemies[type];
    const hp = def.hp * mult;
    ex.enemies.push({
      id: `e${s.nextId++}`,
      type,
      hex: { ...edge[Math.floor(Math.random() * edge.length)] },
      path: [],
      progress: 0,
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

export function tickExpedition(s: GameState, dt: number): void {
  const ex = s.expedition;
  if (!ex) return;
  ex.elapsed += dt;

  if (ex.elapsed >= ex.nextWave && ex.elapsed < ex.duration) {
    spawnWave(s, ex);
    ex.nextWave += CONFIG.expedition.waveInterval;
  }

  const ships = expeditionShips(s);

  // player ships: move, regenerate shields, mine, fight
  for (const ship of ships) {
    const st = shipStats(s, ship.type);
    advance(ship, st.speedExp, dt);
    if (s.time - ship.lastHit > CONFIG.shieldRegenDelay) {
      ship.shield = Math.min(st.shield, ship.shield + st.shield * CONFIG.shieldRegenFraction * dt);
    }
    if (ship.path.length === 0 && st.mineExp > 0) {
      const dep = ex.deposits.find((d) => hexEq(d.hex, ship.hex) && d.shards > 0);
      if (dep) {
        const got = Math.min(st.mineExp * dt, dep.shards, st.cargoExp - ship.shards);
        ship.shards += got;
        dep.shards -= got;
        if (dep.shards < 1e-6) dep.shards = 0; // avoid a float remainder keeping it "not empty"
      }
    }
    if (st.dps > 0) {
      const target = nearest(ex.enemies, ship, 1);
      if (target) target.hp -= st.dps * dt;
    }
  }

  // hand shards from full miners to haulers on the same hex
  for (const miner of ships.filter((x) => x.type === 'miner' && x.shards > 0)) {
    for (const hauler of ships.filter((x) => x.type === 'hauler' && hexEq(x.hex, miner.hex) && x.path.length === 0)) {
      const space = shipStats(s, 'hauler').cargoExp - hauler.shards;
      const moved = Math.min(space, miner.shards);
      hauler.shards += moved;
      miner.shards -= moved;
    }
  }

  // enemies: remove the dead, chase the nearest ship, attack when adjacent
  const before = ex.enemies.length;
  ex.enemies = ex.enemies.filter((en) => en.hp > 0);
  if (ex.enemies.length < before) s.kills += before - ex.enemies.length;
  for (const en of ex.enemies) {
    const target = nearest(ships, en, Infinity);
    if (!target) break;
    const d = hexDistance(en.hex, target.hex);
    if (d <= 1 && en.path.length === 0) {
      damageShip(s, target, en.dps * dt);
    } else {
      if (en.path.length === 0 || !hexEq(en.path[en.path.length - 1], stopNextTo(en, target))) {
        const keep = en.path.length > 0 ? en.progress : 0;
        en.path = hexLine(en.hex, stopNextTo(en, target));
        en.progress = en.path.length > 0 ? keep : 0;
      }
      advance(en, CONFIG.enemies[en.type].speed * CONFIG.speed.expedition, dt);
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

function stopNextTo(en: Enemy, target: Ship) {
  const line = hexLine(en.hex, target.hex);
  return line.length >= 2 ? line[line.length - 2] : en.hex;
}

function nearest<T extends { hex: { q: number; r: number } }>(list: T[], from: { hex: { q: number; r: number } }, range: number): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const x of list) {
    const d = hexDistance(x.hex, from.hex);
    if (d <= range && d < bestD) {
      best = x;
      bestD = d;
    }
  }
  return best;
}

function removeShip(s: GameState, ship: Ship): void {
  s.ships = s.ships.filter((x) => x.id !== ship.id);
  if (s.expedition) s.expedition.shipIds = s.expedition.shipIds.filter((id) => id !== ship.id);
}

export function canJump(ship: Ship): boolean {
  return ship.location === 'expedition' && hexEq(ship.hex, GATE) && ship.path.length === 0;
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
  ship.hex = { ...baseHex(s) };
  ship.path = [];
  ship.progress = 0;
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
