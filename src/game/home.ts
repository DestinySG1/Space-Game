// Home sector simulation: colonies, trade, mining, free ship flight and build queues.
import { CONFIG, moduleInfo } from './config';
import { passiveIncome, shipStats, tradeValuePerUnit } from './economy';
import { center, dist, fly, parkingSpot } from './geom';
import { addShip, baseNode, exploreAt, log, nodeById, nodeNear } from './state';
import type { GameState, ModuleId, SectorNode, Ship, Vec } from './types';

export function sendTo(m: { target: Vec | null }, to: Vec): void {
  m.target = { ...to };
}

/** Where a ship parks at a node: its own spot on a small ring around it. */
export const dockAt = (ship: Ship, node: SectorNode): Vec => parkingSpot(center(node.hex), ship.id, CONFIG.ranges.park);

export function tickHome(s: GameState, dt: number): void {
  const inc = passiveIncome(s);
  s.credits += inc.credits * dt;
  s.ore += inc.ore * dt;
  s.hydrogen += inc.hydrogen * dt;

  for (const n of s.nodes) {
    if (n.kind === 'station') n.stock = Math.min(CONFIG.station.stockCap, n.stock + CONFIG.station.stockRate * dt);
    if (n.kind === 'asteroid') n.ore = Math.min(CONFIG.asteroid.oreMax, n.ore + CONFIG.asteroid.regen * dt);
  }

  for (const ship of s.ships) {
    if (ship.location === 'home') tickHomeShip(s, ship, dt);
  }

  tickQueues(s, dt);
}

function tickHomeShip(s: GameState, ship: Ship, dt: number): void {
  const st = shipStats(s, ship.type, ship);
  // ships at home repair fully over ~20 s
  ship.hull = Math.min(st.hull, ship.hull + st.hull * 0.05 * dt);
  ship.shield = Math.min(st.shield, ship.shield + st.shield * 0.1 * dt);

  // flying burns hydrogen; with an empty tank ships crawl
  const from = ship.pos;
  const speed = st.speedHome * (s.hydrogen >= 1 ? 1 : CONFIG.hydrogen.emptySpeed); // below 1 H₂ counts as empty
  const flying = fly(ship, speed, dt);
  s.hydrogen = Math.max(0, s.hydrogen - dist(from, ship.pos) * CONFIG.hydrogen.burn[ship.type]);
  const found = exploreAt(s, ship.pos);
  if (found) {
    log(s, found.length ? `Erkundet: ${found.map((n) => n.name).join(', ')} entdeckt.` : 'Erkundet: leerer Raum.');
  }
  if (flying) return;
  const here = nodeNear(s, ship.pos);
  if (!here) return;

  if (ship.type === 'hauler' && here.kind === 'station') {
    // sell goods that came from another station
    if (ship.cargo > 0 && ship.cargoOrigin && ship.cargoOrigin !== here.id) {
      const origin = nodeById(s, ship.cargoOrigin)!;
      s.credits += ship.cargo * tradeValuePerUnit(s, origin, here, ship);
      ship.cargo = 0;
      ship.cargoOrigin = null;
    }
    // load local goods
    if (ship.cargo === 0 || ship.cargoOrigin === here.id) {
      const take = Math.min(st.cargoHome - ship.cargo, Math.floor(here.stock));
      if (take > 0) {
        here.stock -= take;
        ship.cargo += take;
        ship.cargoOrigin = here.id;
      }
    }
    if (ship.shuttle && ship.cargo > 0 && (ship.cargo >= st.cargoHome || here.stock < 1)) goOtherEnd(s, ship, here.id);
  }

  if (ship.type === 'miner') {
    if (here.kind === 'asteroid') {
      const mined = Math.min(st.mineHome * dt, st.cargoHome - ship.cargo, here.ore);
      ship.cargo += mined;
      here.ore -= mined;
      if (ship.shuttle && (ship.cargo >= st.cargoHome - 1e-6 || (here.ore < 1 && ship.cargo > 0))) {
        goOtherEnd(s, ship, here.id);
      }
    } else if (here.kind === 'base') {
      s.ore += ship.cargo;
      ship.cargo = 0;
      if (ship.shuttle) goOtherEnd(s, ship, here.id);
    }
  }
}

function goOtherEnd(s: GameState, ship: Ship, hereId: string): void {
  if (!ship.shuttle) return;
  const targetId = ship.shuttle.a === hereId ? ship.shuttle.b : ship.shuttle.b === hereId ? ship.shuttle.a : null;
  const target = nodeById(s, targetId);
  if (target) sendTo(ship, dockAt(ship, target));
}

function tickQueues(s: GameState, dt: number): void {
  const q = s.queue;
  if (q.ship && (q.ship.remaining -= dt) <= 0) {
    const ship = addShip(s, q.ship.target as Ship['type']);
    log(s, `Werft: ${CONFIG.ships[ship.type].name} „${ship.name}“ ist fertig.`);
    q.ship = null;
  }
  if (q.research && (q.research.remaining -= dt) <= 0) {
    const id = q.research.target as ModuleId;
    s.blueprints[id] += 1;
    log(s, `Bauplan: ${moduleInfo(id).name} Stufe ${s.blueprints[id]} entschlüsselt.`);
    refreshStats(s);
    q.research = null;
  }
  if (q.beacon && (q.beacon.remaining -= dt) <= 0) {
    const tier = Number(q.beacon.target);
    s.beacons[tier] = (s.beacons[tier] ?? 0) + 1;
    log(s, `Schmiede: Sprungkern Stufe ${tier} bereit.`);
    q.beacon = null;
  }
}

/** After an upgrade, keep current hull/shield but never above the new maximums. */
export function refreshStats(s: GameState): void {
  for (const ship of s.ships) {
    const st = shipStats(s, ship.type, ship);
    ship.hull = Math.min(st.hull, ship.hull);
    ship.shield = Math.min(st.shield, ship.shield);
  }
}

export const basePos = (s: GameState) => center(baseNode(s).hex);
export { dist };
