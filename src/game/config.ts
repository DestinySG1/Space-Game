// All balancing numbers live here. Change values, not code, to tune the economy.
// Rates are per second of game time unless noted otherwise.

import type { ModuleId, ShipType } from './types';

export const CONFIG = {
  saveKey: 'lumen-reach-save-v1',
  saveVersion: 2,
  tick: 0.1, // fixed simulation step in seconds
  offlineCapSeconds: 8 * 3600,

  start: { credits: 600, ore: 60, shards: 0 },

  sector: {
    radius: 8, // 4x the area of the first prototype
    planets: 18,
    stations: 6,
    asteroids: 10,
  },

  planet: {
    colonizeBase: 250,
    colonizeGrowth: 1.45, // cost multiplier per planet already colonized
    upgradeCredits: 180,
    upgradeOre: 30,
    upgradeGrowth: 1.75,
    maxLevel: 10,
    exponent: 1.15, // production = base * level^exponent
    rock: { credits: 0.05, ore: 0.15 },
    garden: { credits: 0.5, ore: 0.02 },
  },

  station: {
    stockRate: 0.12, // trade goods produced per second
    stockCap: 30,
    valueBase: 6, // credits per unit
    valuePerHex: 4, // extra credits per unit per hex between origin and destination
  },

  asteroid: { oreMax: 400, regen: 0.3 },

  hangar: { baseSlots: 3, upgradeCredits: 1200, upgradeOre: 200, growth: 2.0, maxLevel: 6 },

  ships: {
    hauler: {
      name: 'Frachter', credits: 400, ore: 0, buildTime: 20,
      speed: 1.1, hull: 500, shield: 100, dps: 0,
      cargoHome: 6, cargoExp: 40, mineHome: 0, mineExp: 0,
    },
    miner: {
      name: 'Schürfer', credits: 500, ore: 50, buildTime: 25,
      speed: 0.9, hull: 450, shield: 100, dps: 0,
      cargoHome: 60, cargoExp: 20, mineHome: 0.5, mineExp: 0.08,
    },
    warden: {
      name: 'Wächter', credits: 800, ore: 120, buildTime: 40,
      speed: 1.0, hull: 1500, shield: 500, dps: 60,
      cargoHome: 0, cargoExp: 4, mineHome: 0, mineExp: 0,
    },
  } satisfies Record<ShipType, ShipConfig>,

  // World units: one hex has radius `hexSize`, so there is room to manoeuvre inside a hex.
  // Neighbouring hex centres are hexSize × √3 ≈ 10.4 units apart.
  hexSize: 6,
  // world units per second, multiplied by ship speed
  speed: { home: 2.0, expedition: 3.0 },
  ranges: {
    dock: 1.8, // a ship this close to a planet, station, belt or deposit counts as "there"
    park: 1.25, // ships park on a ring around a node so they don't overlap
    gate: 2.0, // may jump home this close to the gate
    weapon: 4.0, // warden fire range
    enemyAttack: 3.0, // enemies stop and fire at this distance
    transfer: 2.5, // miner hands shards to a hauler this close
    taunt: 5.0, // enemies switch to a warden that is at most this much farther away than their nearest ship
  },
  shieldRegenDelay: 4,
  shieldRegenFraction: 0.05, // of max shield per second

  research: {
    creditsBase: 300,
    creditsGrowth: 2.0,
    oreBase: 60,
    oreGrowth: 2.0,
    shardsBase: 6, // level 1 is free of shards; level n costs shardsBase * growth^(n-2)
    shardsGrowth: 1.9,
    timeBase: 30,
    timeGrowth: 1.7,
    maxLevel: 5,
  },

  beacon: {
    credits: 500, ore: 100, time: 45, growth: 1.7, // cost per tier: base * growth^(tier-1)
  },

  expedition: {
    duration: 15 * 60,
    radius: 8,
    maxShips: 4,
    depositsBase: 16,
    depositShardsMin: 10,
    depositShardsMax: 18,
    depositTierExponent: 1.3,
    firstWave: 60,
    waveInterval: 55,
    extraEnemyEveryWaves: 5, // one more enemy per wave every N waves
    extraEnemyEveryTiers: 2, // and one more every N tiers
    tierStrength: 0.35, // enemy stat bonus per tier above 1
    timeStrength: 0.5, // enemy stat bonus at the very end of the timer
    collapseWarning: 90,
    unlockShardsPerTier: 25, // bank this many * tier to unlock the next tier
  },

  enemies: {
    skirmisher: { name: 'Splitterling', hp: 220, dps: 10, speed: 0.75 },
    colossus: { name: 'Koloss', hp: 1200, dps: 30, speed: 0.4, fromWave: 10 },
  },
} as const;

export interface ShipConfig {
  name: string;
  credits: number;
  ore: number;
  buildTime: number;
  speed: number;
  hull: number;
  shield: number;
  dps: number;
  cargoHome: number;
  cargoExp: number;
  mineHome: number;
  mineExp: number;
}

export interface ModuleInfo {
  id: ModuleId;
  name: string;
  desc: string;
  perLevel: number; // fractional bonus per level, e.g. 0.2 = +20 %
}

export const MODULES: ModuleInfo[] = [
  { id: 'cargoBay', name: 'Laderaum', desc: 'Frachtkapazität aller Schiffe', perLevel: 0.25 },
  { id: 'tradeLink', name: 'Handelsnetz', desc: 'Credits pro gelieferter Ware', perLevel: 0.12 },
  { id: 'drillHead', name: 'Bohrkopf', desc: 'Abbaurate von Erz und Splittern', perLevel: 0.25 },
  { id: 'engines', name: 'Triebwerke', desc: 'Geschwindigkeit aller Schiffe', perLevel: 0.1 },
  { id: 'armor', name: 'Panzerung', desc: 'Rumpfpunkte aller Schiffe', perLevel: 0.2 },
  { id: 'shields', name: 'Schildgitter', desc: 'Schildstärke aller Schiffe', perLevel: 0.25 },
  { id: 'cannons', name: 'Pulskanonen', desc: 'Schaden der Wächter', perLevel: 0.2 },
  { id: 'scanner', name: 'Tiefenscanner', desc: 'Splitter in Expeditions-Vorkommen', perLevel: 0.1 },
];
