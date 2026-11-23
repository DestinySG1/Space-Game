// All balancing numbers live here. Change values, not code, to tune the economy.
// Rates are per second of game time unless noted otherwise.

import type { ModuleId, ShipType, SlotType } from './types';

export const CONFIG = {
  saveKey: 'lumen-reach-save-v1',
  saveVersion: 5,
  tick: 0.1, // fixed simulation step in seconds
  offlineCapSeconds: 8 * 3600,

  start: { credits: 600, ore: 60, shards: 0, hydrogen: 120 },

  sector: {
    radius: 8, // 4x the area of the first prototype
    planets: 18,
    stations: 6,
    asteroids: 10,
    gasGiants: 4,
    exploredRadius: 1, // the base and its 6 neighbours start visible, the rest is nebula
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

  hydrogen: {
    baseOutput: 0.02, // per second from the home base, so you are never stuck for good
    refineryBase: 300, // credits for the first refinery on a gas giant
    refineryGrowth: 1.6, // per refinery already built
    upgradeCredits: 250,
    upgradeOre: 40,
    upgradeGrowth: 1.75,
    maxLevel: 10,
    output: 0.12, // per second at level 1, × level^exponent
    exponent: 1.15,
    burn: { hauler: 0.03, miner: 0.03, warden: 0.05 }, // per world unit flown in the home sector
    emptySpeed: 0.25, // speed factor with an empty tank
    jumpPerShip: 15, // × tier, paid when an expedition starts
  },

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
    pulseRadius: 6,
    pulseStun: 3,
    droneRadius: 5,
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
  slot: SlotType;
  name: string;
  desc: string;
  perLevel: number; // bonus per blueprint level (meaning depends on the module, see economy.ts)
  cooldown?: number; // active modules: seconds between uses
}

/** Which module slots each ship type has. */
export const SLOTS: Record<ShipType, SlotType[]> = {
  hauler: ['trade', 'shield'],
  miner: ['mining', 'shield'],
  warden: ['weapon', 'shield', 'support'],
};

export const SLOT_NAMES: Record<SlotType, string> = {
  weapon: 'Waffe', shield: 'Schild', support: 'Unterstützung', trade: 'Handel', mining: 'Abbau',
};

export const MODULES: ModuleInfo[] = [
  { id: 'lance', slot: 'weapon', name: 'Phasenlanze', desc: 'Konzentrierter Strahl auf ein Ziel: +35 % Schaden pro Stufe', perLevel: 0.35 },
  { id: 'scatter', slot: 'weapon', name: 'Streukanone', desc: 'Trifft bis zu 3 Ziele gleichzeitig mit je 50 % Schaden, +15 % pro Stufe', perLevel: 0.15 },
  { id: 'deflector', slot: 'shield', name: 'Deflektor', desc: '+40 % Schildstärke pro Stufe', perLevel: 0.4 },
  { id: 'regen', slot: 'shield', name: 'Regenerator', desc: 'Schild lädt schon nach 1,5 s nach, +60 % Laderate pro Stufe', perLevel: 0.6 },
  { id: 'plating', slot: 'shield', name: 'Verbundpanzerung', desc: '+25 % Rumpfpunkte pro Stufe', perLevel: 0.25 },
  { id: 'pulse', slot: 'support', name: 'Störimpuls', desc: 'Aktiv: lähmt Gegner im Umkreis von 6 für 3 s, +0,6 s pro Stufe', perLevel: 0.6, cooldown: 60 },
  { id: 'blink', slot: 'support', name: 'Notsprung', desc: 'Aktiv: springt sofort zum Sprungtor. Abklingzeit 150 s, −15 s pro Stufe', perLevel: 15, cooldown: 150 },
  { id: 'drone', slot: 'support', name: 'Reparaturdrohne', desc: 'Repariert Schiffe im Umkreis von 5 um 6 Rumpf/s pro Stufe', perLevel: 6 },
  { id: 'thrusters', slot: 'support', name: 'Schubdüsen', desc: '+15 % Tempo pro Stufe', perLevel: 0.15 },
  { id: 'cargo', slot: 'trade', name: 'Frachtringe', desc: '+30 % Laderaum pro Stufe', perLevel: 0.3 },
  { id: 'broker', slot: 'trade', name: 'Handelsrechner', desc: '+15 % Credits pro gelieferter Ware pro Stufe', perLevel: 0.15 },
  { id: 'drill', slot: 'mining', name: 'Bohrlaser', desc: '+30 % Abbaurate (Erz und Splitter) pro Stufe', perLevel: 0.3 },
  { id: 'bunker', slot: 'mining', name: 'Erzbunker', desc: '+35 % Laderaum des Schürfers pro Stufe', perLevel: 0.35 },
];

export const moduleInfo = (id: ModuleId) => MODULES.find((m) => m.id === id)!;
