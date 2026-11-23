// Home sector simulation: colonies, trade, mining, ship travel and build queues.
import { CONFIG } from './config';
import { passiveIncome, shipStats, tradeValuePerUnit } from './economy';
import { hexEq, hexLine } from './hex';
import { addShip, baseNode, log, nodeAt, nodeById } from './state';
import type { GameState, Hex, ModuleId, Ship } from './types';
import { MODULES } from './config';

export interface Mover {
  hex: Hex;
  path: Hex[];
  progress: number;
}

/** Advance along the path. Returns true while still travelling. */
export function advance(m: Mover, speed: number, dt: number): boolean {
  if (m.path.length === 0) {
    m.progress = 0;
    return false;
  }
  m.progress += speed * dt;
  while (m.progress >= 1 && m.path.length > 0) {
    m.hex = m.path.shift()!;
    m.progress -= 1;
  }
  if (m.path.length === 0) m.progress = 0;
  return m.path.length > 0;
}

export function sendTo(m: Mover, target: Hex): void {
  const last = m.path[m.path.length - 1];
  if (last && hexEq(last, target)) return; // already on the way, keep going
  const next = m.path[0];
  const path = hexEq(m.hex, target) ? [] : hexLine(m.hex, target);
  // keep progress if the first step stays the same, so re-routing mid-flight doesn't stall
  m.progress = next && path[0] && hexEq(next, path[0]) ? m.progress : 0;
  m.path = path;
}

export function tickHome(s: GameState, dt: number): void {
  const inc = passiveIncome(s);
  s.credits += inc.credits * dt;
  s.ore += inc.ore * dt;

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
  const st = shipStats(s, ship.type);
  // ships at home repair fully over ~20 s
  ship.hull = Math.min(st.hull, ship.hull + st.hull * 0.05 * dt);
  ship.shield = Math.min(st.shield, ship.shield + st.shield * 0.1 * dt);

  if (advance(ship, st.speedHome, dt)) return;
  const here = nodeAt(s, ship.hex);
  if (!here) return;

  if (ship.type === 'hauler' && here.kind === 'station') {
    // sell goods that came from another station
    if (ship.cargo > 0 && ship.cargoOrigin && ship.cargoOrigin !== here.id) {
      const origin = nodeById(s, ship.cargoOrigin)!;
      const earned = ship.cargo * tradeValuePerUnit(s, origin, here);
      s.credits += earned;
      ship.cargo = 0;
      ship.cargoOrigin = null;
    }
    // load local goods
    if (ship.cargo === 0 || ship.cargoOrigin === here.id) {
      const space = st.cargoHome - ship.cargo;
      const take = Math.min(space, Math.floor(here.stock));
      if (take > 0) {
        here.stock -= take;
        ship.cargo += take;
        ship.cargoOrigin = here.id;
      }
    }
    if (ship.shuttle && ship.cargo > 0) {
      const full = ship.cargo >= st.cargoHome;
      if (full || here.stock < 1) goOtherEnd(s, ship, here.id);
    }
  }

  if (ship.type === 'miner') {
    if (here.kind === 'asteroid') {
      const space = st.cargoHome - ship.cargo;
      const mined = Math.min(st.mineHome * dt, space, here.ore);
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
  if (target) sendTo(ship, target.hex);
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
    s.modules[id] += 1;
    const info = MODULES.find((m) => m.id === id)!;
    log(s, `Forschung: ${info.name} Stufe ${s.modules[id]} abgeschlossen.`);
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

/** After an upgrade, keep current hull/shield ratio but apply the new maximums. */
export function refreshStats(s: GameState): void {
  for (const ship of s.ships) {
    const st = shipStats(s, ship.type);
    ship.hull = Math.min(st.hull, ship.hull);
    ship.shield = Math.min(st.shield, ship.shield);
  }
}

export const baseHex = (s: GameState) => baseNode(s).hex;
