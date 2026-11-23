// Everything the player can do. Each action validates, changes state and returns a message for the UI.
import { CONFIG, SLOTS, moduleInfo } from './config';
import {
  beaconCost, canAfford, colonizeCost, hangarSlots, hangarUpgradeCost, jumpFuel, pay, planetUpgradeCost, refineryCost,
  moduleCooldown, refineryUpgradeCost, researchCost, shipCost,
} from './economy';
import { GATE_POS, canJump, createExpedition, expeditionShips, gateSpot, inRange, jumpHome } from './expedition';
import { dist, insideMap } from './geom';
import { dockAt, sendTo } from './home';
import { isExplored, log, nodeById, nodeNear, shipById } from './state';
import type { GameState, ModuleId, Ship, ShipType, SlotType, Vec } from './types';

export interface Result {
  ok: boolean;
  msg: string;
}
const ok = (msg: string): Result => ({ ok: true, msg });
const fail = (msg: string): Result => ({ ok: false, msg });
const notEnough = 'Nicht genug Ressourcen.';

export function colonize(s: GameState, nodeId: string): Result {
  const n = nodeById(s, nodeId);
  if (!n || n.kind !== 'planet' || n.level > 0) return fail('Hier kann nicht kolonisiert werden.');
  if (!isExplored(s, n.hex)) return fail('Dieses Gebiet ist noch nicht erforscht.');
  const c = colonizeCost(s);
  if (!canAfford(s, c)) return fail(notEnough);
  pay(s, c);
  n.level = 1;
  log(s, `${n.name} wurde kolonisiert.`);
  return ok(`${n.name} kolonisiert.`);
}

export function upgradePlanet(s: GameState, nodeId: string): Result {
  const n = nodeById(s, nodeId);
  if (!n || n.kind !== 'planet' || n.level < 1) return fail('Erst kolonisieren.');
  if (n.level >= CONFIG.planet.maxLevel) return fail('Maximale Stufe erreicht.');
  const c = planetUpgradeCost(n);
  if (!canAfford(s, c)) return fail(notEnough);
  pay(s, c);
  n.level += 1;
  return ok(`${n.name} auf Stufe ${n.level} ausgebaut.`);
}

export function buildRefinery(s: GameState, nodeId: string): Result {
  const n = nodeById(s, nodeId);
  if (!n || n.kind !== 'gasgiant' || n.level > 0) return fail('Hier kann keine Raffinerie gebaut werden.');
  if (!isExplored(s, n.hex)) return fail('Dieses Gebiet ist noch nicht erforscht.');
  const c = refineryCost(s);
  if (!canAfford(s, c)) return fail(notEnough);
  pay(s, c);
  n.level = 1;
  log(s, `Raffinerie an ${n.name} gebaut.`);
  return ok(`Raffinerie an ${n.name} gebaut.`);
}

export function upgradeRefinery(s: GameState, nodeId: string): Result {
  const n = nodeById(s, nodeId);
  if (!n || n.kind !== 'gasgiant' || n.level < 1) return fail('Erst eine Raffinerie bauen.');
  if (n.level >= CONFIG.hydrogen.maxLevel) return fail('Maximale Stufe erreicht.');
  const c = refineryUpgradeCost(n);
  if (!canAfford(s, c)) return fail(notEnough);
  pay(s, c);
  n.level += 1;
  return ok(`Raffinerie an ${n.name} auf Stufe ${n.level} ausgebaut.`);
}

export function upgradeHangar(s: GameState): Result {
  if (s.hangar >= CONFIG.hangar.maxLevel) return fail('Hangar voll ausgebaut.');
  const c = hangarUpgradeCost(s);
  if (!canAfford(s, c)) return fail(notEnough);
  pay(s, c);
  s.hangar += 1;
  return ok(`Hangar erweitert: ${hangarSlots(s)} Schiffsplätze.`);
}

export function buildShip(s: GameState, type: ShipType): Result {
  if (s.queue.ship) return fail('Die Werft ist beschäftigt.');
  if (s.ships.length >= hangarSlots(s)) return fail('Kein Platz im Hangar.');
  const c = shipCost(type);
  if (!canAfford(s, c)) return fail(notEnough);
  pay(s, c);
  const t = CONFIG.ships[type].buildTime;
  s.queue.ship = { kind: 'ship', target: type, remaining: t, total: t };
  return ok(`${CONFIG.ships[type].name} wird gebaut.`);
}

/** Decode the next level of a module blueprint (needs shards from level 2 on). */
export function research(s: GameState, id: ModuleId): Result {
  if (s.queue.research) return fail('Es wird bereits ein Bauplan entschlüsselt.');
  if (s.blueprints[id] >= CONFIG.research.maxLevel) return fail('Maximale Stufe erreicht.');
  const c = researchCost(s, id);
  if (!canAfford(s, c)) return fail(notEnough);
  pay(s, c);
  s.queue.research = { kind: 'research', target: id, remaining: c.time, total: c.time };
  return ok(`Bauplan ${moduleInfo(id).name} wird entschlüsselt.`);
}

/** Install a module in the matching slot of a ship, or clear the slot with id = null. */
export function equip(s: GameState, shipId: string, slot: SlotType, id: ModuleId | null): Result {
  const ship = shipById(s, shipId);
  if (!ship) return fail('Schiff nicht gefunden.');
  if (ship.location !== 'home') return fail('Module können nur im Heimat-Sektor gewechselt werden.');
  if (!SLOTS[ship.type].includes(slot)) return fail('Dieses Schiff hat keinen solchen Platz.');
  if (id === null) {
    delete ship.fit[slot];
    return ok('Modul ausgebaut.');
  }
  const m = moduleInfo(id);
  if (m.slot !== slot) return fail('Das Modul passt nicht in diesen Platz.');
  if (s.blueprints[id] < 1) return fail('Erst den Bauplan entschlüsseln.');
  ship.fit[slot] = id;
  return ok(`${m.name} in ${ship.name} eingebaut.`);
}

/** Seconds until an active module on this ship can be used again (0 = ready). */
export const cooldownLeft = (s: GameState, ship: Ship, id: ModuleId) => Math.max(0, (ship.cooldowns[id] ?? 0) - s.time);

/** Use the active support module of a ship in an expedition. */
export function activate(s: GameState, shipId: string): Result {
  const ship = shipById(s, shipId);
  const ex = s.expedition;
  if (!ship || !ex || ship.location !== 'expedition') return fail('Nur in einer Expedition einsetzbar.');
  const id = ship.fit.support;
  if (!id || !moduleInfo(id).cooldown) return fail('Kein aktives Modul eingebaut.');
  if (cooldownLeft(s, ship, id) > 0) return fail(`Noch ${Math.ceil(cooldownLeft(s, ship, id))} s Abklingzeit.`);
  ship.cooldowns[id] = s.time + moduleCooldown(s, id);
  if (id === 'pulse') {
    const until = s.time + CONFIG.expedition.pulseStun + moduleInfo('pulse').perLevel * (s.blueprints.pulse - 1);
    const hit = inRange(ex.enemies, ship.pos, CONFIG.expedition.pulseRadius);
    for (const en of hit) en.stunnedUntil = until;
    return ok(`Störimpuls: ${hit.length} Gegner gelähmt.`);
  }
  ship.pos = gateSpot(ship);
  ship.target = null;
  return ok(`${ship.name} ist zum Sprungtor gesprungen.`);
}

export function craftBeacon(s: GameState, tier: number): Result {
  if (s.queue.beacon) return fail('Die Schmiede ist beschäftigt.');
  if (tier < 1 || tier > s.maxTier) return fail('Diese Stufe ist noch nicht freigeschaltet.');
  const c = beaconCost(tier);
  if (!canAfford(s, c)) return fail(notEnough);
  pay(s, c);
  s.queue.beacon = { kind: 'beacon', target: String(tier), remaining: c.time, total: c.time };
  return ok(`Sprungkern Stufe ${tier} wird geschmiedet.`);
}

/** Fly a ship to any point on its map. */
export function moveShip(s: GameState, shipId: string, to: Vec): Result {
  const ship = shipById(s, shipId);
  if (!ship) return fail('Schiff nicht gefunden.');
  const radius = ship.location === 'home' ? CONFIG.sector.radius : CONFIG.expedition.radius;
  if (!insideMap(to, radius)) return fail('Außerhalb der Karte.');
  ship.shuttle = null;
  sendTo(ship, to);
  return ok(`${ship.name} fliegt los.`);
}

/** Valid shuttle partners for a ship that is idle at a node. */
export function shuttleTargets(s: GameState, shipId: string): string[] {
  const ship = shipById(s, shipId);
  if (!ship || ship.location !== 'home' || ship.target) return [];
  const here = nodeNear(s, ship.pos);
  if (!here) return [];
  if (ship.type === 'hauler' && here.kind === 'station') {
    return s.nodes.filter((n) => n.kind === 'station' && n.id !== here.id && isExplored(s, n.hex)).map((n) => n.id);
  }
  if (ship.type === 'miner' && here.kind === 'asteroid') return ['base'];
  if (ship.type === 'miner' && here.kind === 'base') {
    return s.nodes.filter((n) => n.kind === 'asteroid' && isExplored(s, n.hex)).map((n) => n.id);
  }
  return [];
}

export function setShuttle(s: GameState, shipId: string, targetId: string): Result {
  const ship = shipById(s, shipId);
  const here = ship && nodeNear(s, ship.pos);
  const target = nodeById(s, targetId);
  if (!ship || !here || !target || !shuttleTargets(s, shipId).includes(targetId)) return fail('Route nicht möglich.');
  ship.shuttle = { a: here.id, b: target.id };
  // a hauler sitting on its own goods or a miner still mining stays until full; otherwise leave now
  const waitForCargo = (ship.type === 'hauler' && ship.cargo === 0) || (ship.type === 'miner' && here.kind === 'asteroid');
  if (!waitForCargo) sendTo(ship, dockAt(ship, target));
  return ok(`Pendelroute ${here.name} ↔ ${target.name} aktiv.`);
}

export function stopShuttle(s: GameState, shipId: string): Result {
  const ship = shipById(s, shipId);
  if (!ship) return fail('Schiff nicht gefunden.');
  ship.shuttle = null;
  return ok('Pendelroute beendet.');
}

export function launchExpedition(s: GameState, tier: number, shipIds: string[], seed = Math.floor(Math.random() * 1e9)): Result {
  if (s.expedition) return fail('Es läuft bereits eine Expedition.');
  if (s.coop) return fail('Deine Schiffe sind gerade in einer Koop-Anomalie.');
  if ((s.beacons[tier] ?? 0) < 1) return fail(`Kein Sprungkern der Stufe ${tier} vorhanden.`);
  const ships = shipIds.map((id) => shipById(s, id)).filter((x) => x && x.location === 'home');
  if (ships.length === 0) return fail('Wähle mindestens ein Schiff.');
  if (ships.length > CONFIG.expedition.maxShips) return fail(`Höchstens ${CONFIG.expedition.maxShips} Schiffe.`);
  const fuel = jumpFuel(tier, ships.length);
  if (s.hydrogen < fuel) return fail(`Zu wenig Wasserstoff: Der Sprung braucht ${fuel}.`);
  s.hydrogen -= fuel;
  s.beacons[tier] -= 1;
  s.expedition = createExpedition(s, tier, ships.map((x) => x!.id), seed);
  for (const ship of ships) {
    if (!ship) continue;
    ship.location = 'expedition';
    ship.pos = gateSpot(ship);
    ship.target = null;
    ship.cargo = 0;
    ship.cargoOrigin = null;
    ship.shuttle = null;
    ship.shards = 0;
  }
  log(s, `Expedition Stufe ${tier} gestartet mit ${ships.length} Schiff(en).`);
  return ok('Sprung in die Anomalie!');
}

export function jump(s: GameState, shipId: string): Result {
  const ship = shipById(s, shipId);
  if (!ship || !jumpHome(s, ship)) return fail('Das Schiff muss still am Sprungtor stehen.');
  return ok(`${ship.name} ist zurückgesprungen.`);
}

export function jumpAllAtGate(s: GameState): Result {
  const ready = expeditionShips(s).filter(canJump);
  if (ready.length === 0) return fail('Kein Schiff steht am Sprungtor.');
  for (const ship of ready) jumpHome(s, ship);
  return ok(`${ready.length} Schiff(e) zurückgesprungen.`);
}

export function recallAllToGate(s: GameState): Result {
  const ships = expeditionShips(s);
  for (const ship of ships) if (dist(ship.pos, GATE_POS) > CONFIG.ranges.gate * 0.6) sendTo(ship, gateSpot(ship));
  return ok('Alle Schiffe fliegen zum Sprungtor.');
}
