// Pure formulas: costs, production and ship stats. No state is changed here.
import { CONFIG, MODULES } from './config';
import { hexDistance } from './hex';
import type { GameState, ModuleId, SectorNode, ShipType } from './types';

export interface Cost {
  credits: number;
  ore: number;
  shards: number;
}

const round = (n: number) => Math.round(n);

export function canAfford(s: GameState, c: Cost): boolean {
  return s.credits >= c.credits && s.ore >= c.ore && s.shards >= c.shards;
}

export function pay(s: GameState, c: Cost): void {
  s.credits -= c.credits;
  s.ore -= c.ore;
  s.shards -= c.shards;
}

export const bonus = (s: GameState, id: ModuleId) =>
  1 + s.modules[id] * (MODULES.find((m) => m.id === id)?.perLevel ?? 0);

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

/** Passive income per second from colonies (trade and mining not included). */
export function passiveIncome(s: GameState): { credits: number; ore: number } {
  let credits = 0;
  let ore = 0;
  for (const n of s.nodes) {
    const o = planetOutput(n);
    credits += o.credits;
    ore += o.ore;
  }
  return { credits, ore };
}

// ---- Trade ------------------------------------------------------------------

export function tradeValuePerUnit(s: GameState, from: SectorNode, to: SectorNode): number {
  const st = CONFIG.station;
  const d = hexDistance(from.hex, to.hex);
  return (st.valueBase + st.valuePerHex * d) * bonus(s, 'tradeLink');
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
  dps: number;
  cargoHome: number;
  cargoExp: number;
  mineHome: number;
  mineExp: number;
}

export function shipStats(s: GameState, type: ShipType): ShipStats {
  const c = CONFIG.ships[type];
  const speed = c.speed * bonus(s, 'engines');
  const cargo = bonus(s, 'cargoBay');
  const drill = bonus(s, 'drillHead');
  return {
    speedHome: CONFIG.speed.home * speed,
    speedExp: CONFIG.speed.expedition * speed,
    hull: c.hull * bonus(s, 'armor'),
    shield: c.shield * bonus(s, 'shields'),
    dps: c.dps * bonus(s, 'cannons'),
    cargoHome: Math.floor(c.cargoHome * cargo),
    cargoExp: Math.floor(c.cargoExp * cargo),
    mineHome: c.mineHome * drill,
    mineExp: c.mineExp * drill,
  };
}

// ---- Research ---------------------------------------------------------------

export function researchCost(s: GameState, id: ModuleId): Cost & { time: number } {
  const r = CONFIG.research;
  const l = s.modules[id]; // current level, cost is for l + 1
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
