// Pure formulas: costs, production and ship stats. No state is changed here.
import { CONFIG, moduleInfo } from './config';
import { hexDistance } from './hex';
import type { GameState, ModuleId, SectorNode, Ship, ShipType } from './types';

export interface Cost {
  credits: number;
  ore: number;
  shards: number;
  hydrogen?: number;
}

const round = (n: number) => Math.round(n);

export function canAfford(s: GameState, c: Cost): boolean {
  return s.credits >= c.credits && s.ore >= c.ore && s.shards >= c.shards && s.hydrogen >= (c.hydrogen ?? 0);
}

export function pay(s: GameState, c: Cost): void {
  s.credits -= c.credits;
  s.ore -= c.ore;
  s.shards -= c.shards;
  s.hydrogen -= c.hydrogen ?? 0;
}

/** Blueprint level of a module if this ship has it installed, else 0. */
export function fitted(s: GameState, ship: Ship | undefined, id: ModuleId): number {
  if (!ship) return 0;
  return ship.fit[moduleInfo(id).slot] === id ? s.blueprints[id] : 0;
}

// ---- Planets ----------------------------------------------------------------

export function colonizedCount(s: GameState): number {
  return s.nodes.filter((n) => n.kind === 'planet' && n.level > 0).length;
}

export function colonizeCost(s: GameState): Cost {
  const p = CONFIG.planet;
  return { credits: round(p.colonizeBase * p.colonizeGrowth ** colonizedCount(s)), ore: 0, shards: 0 };
}

export function planetUpgradeCost(node: SectorNode): Cost {
  const p = CONFIG.planet;
  const l = node.level;
  return {
    credits: round(p.upgradeCredits * p.upgradeGrowth ** (l - 1)),
    ore: round(p.upgradeOre * p.upgradeGrowth ** (l - 1)),
    shards: 0,
  };
}

export function planetOutput(node: SectorNode): { credits: number; ore: number } {
  if (node.kind !== 'planet' || node.level <= 0 || !node.planetType) return { credits: 0, ore: 0 };
  const base = CONFIG.planet[node.planetType];
  const f = node.level ** CONFIG.planet.exponent;
  return { credits: base.credits * f, ore: base.ore * f };
}

/** Passive income per second from colonies and refineries (trade and mining not included). */
export function passiveIncome(s: GameState): { credits: number; ore: number; hydrogen: number } {
  let credits = 0;
  let ore = 0;
  let hydrogen = CONFIG.hydrogen.baseOutput;
  for (const n of s.nodes) {
    const o = planetOutput(n);
    credits += o.credits;
    ore += o.ore;
    hydrogen += refineryOutput(n);
  }
  return { credits, ore, hydrogen };
}

// ---- Hydrogen ---------------------------------------------------------------

export const refineryCount = (s: GameState) => s.nodes.filter((n) => n.kind === 'gasgiant' && n.level > 0).length;

export function refineryCost(s: GameState): Cost {
  const h = CONFIG.hydrogen;
  return { credits: round(h.refineryBase * h.refineryGrowth ** refineryCount(s)), ore: 0, shards: 0 };
}

export function refineryUpgradeCost(node: SectorNode): Cost {
  const h = CONFIG.hydrogen;
  const g = h.upgradeGrowth ** (node.level - 1);
  return { credits: round(h.upgradeCredits * g), ore: round(h.upgradeOre * g), shards: 0 };
}

export function refineryOutput(node: SectorNode): number {
  if (node.kind !== 'gasgiant' || node.level <= 0) return 0;
  return CONFIG.hydrogen.output * node.level ** CONFIG.hydrogen.exponent;
}

/** Hydrogen needed to send these ships into an expedition of this tier. */
export const jumpFuel = (tier: number, ships: number) => CONFIG.hydrogen.jumpPerShip * tier * ships;

// ---- Trade ------------------------------------------------------------------

export function tradeValuePerUnit(s: GameState, from: SectorNode, to: SectorNode, ship?: Ship): number {
  const st = CONFIG.station;
  const d = hexDistance(from.hex, to.hex);
  return (st.valueBase + st.valuePerHex * d) * (1 + fitted(s, ship, 'broker') * moduleInfo('broker').perLevel);
}

// ---- Hangar & ships ---------------------------------------------------------

export const hangarSlots = (s: GameState) => CONFIG.hangar.baseSlots + s.hangar;

export function hangarUpgradeCost(s: GameState): Cost {
  const h = CONFIG.hangar;
  const g = h.growth ** s.hangar;
  return { credits: round(h.upgradeCredits * g), ore: round(h.upgradeOre * g), shards: 0 };
}

export function shipCost(type: ShipType): Cost {
  const c = CONFIG.ships[type];
  return { credits: c.credits, ore: c.ore, shards: 0 };
}

export interface ShipStats {
  speedHome: number;
  speedExp: number;
  hull: number;
  shield: number;
  shieldRegen: number; // fraction of max shield per second
  shieldDelay: number; // seconds without hits before the shield recharges
  dps: number; // damage per second against each target
  targets: number; // how many enemies it can hit at once
  repair: number; // hull per second healed on ships nearby (repair drone)
  cargoHome: number;
  cargoExp: number;
  mineHome: number;
  mineExp: number;
}

/** Stats of a ship type, including the modules installed on `ship` when given. */
export function shipStats(s: GameState, type: ShipType, ship?: Ship): ShipStats {
  const c = CONFIG.ships[type];
  const L = (id: ModuleId) => fitted(s, ship, id);
  const per = (id: ModuleId) => moduleInfo(id).perLevel;
  const speed = c.speed * (1 + L('thrusters') * per('thrusters'));
  const cargo = (1 + L('cargo') * per('cargo')) * (1 + L('bunker') * per('bunker'));
  const drill = 1 + L('drill') * per('drill');
  const scatter = L('scatter');
  let dps = c.dps * (1 + L('lance') * per('lance'));
  if (scatter > 0) dps = c.dps * (0.5 + scatter * per('scatter'));
  const regen = L('regen');
  return {
    speedHome: CONFIG.speed.home * speed,
    speedExp: CONFIG.speed.expedition * speed,
    hull: c.hull * (1 + L('plating') * per('plating')),
    shield: c.shield * (1 + L('deflector') * per('deflector')),
    shieldRegen: CONFIG.shieldRegenFraction * (1 + regen * per('regen')),
    shieldDelay: regen > 0 ? 1.5 : CONFIG.shieldRegenDelay,
    dps,
    targets: scatter > 0 ? 3 : 1,
    repair: L('drone') * per('drone'),
    cargoHome: Math.floor(c.cargoHome * cargo),
    cargoExp: Math.floor(c.cargoExp * cargo),
    mineHome: c.mineHome * drill,
    mineExp: c.mineExp * drill,
  };
}

/** Seconds between uses of an active module at its current blueprint level. */
export function moduleCooldown(s: GameState, id: ModuleId): number {
  const m = moduleInfo(id);
  if (!m.cooldown) return 0;
  return id === 'blink' ? Math.max(30, m.cooldown - m.perLevel * (s.blueprints[id] - 1)) : m.cooldown;
}

// ---- Research ---------------------------------------------------------------

export function researchCost(s: GameState, id: ModuleId): Cost & { time: number } {
  const r = CONFIG.research;
  const l = s.blueprints[id]; // current level, cost is for l + 1
  return {
    credits: round(r.creditsBase * r.creditsGrowth ** l),
    ore: round(r.oreBase * r.oreGrowth ** l),
    shards: l === 0 ? 0 : round(r.shardsBase * r.shardsGrowth ** (l - 1)),
    time: round(r.timeBase * r.timeGrowth ** l),
  };
}

// ---- Expedition beacons -----------------------------------------------------

export function beaconCost(tier: number): Cost & { time: number } {
  const b = CONFIG.beacon;
  const g = b.growth ** (tier - 1);
  return { credits: round(b.credits * g), ore: round(b.ore * g), shards: 0, time: round(b.time * Math.sqrt(g)) };
}

export const unlockThreshold = (tier: number) => CONFIG.expedition.unlockShardsPerTier * tier;
