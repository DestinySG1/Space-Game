export interface Hex {
  q: number;
  r: number;
}

/** Continuous position in world units (hex radius = 1). */
export interface Vec {
  x: number;
  y: number;
}

export type ShipType = 'hauler' | 'miner' | 'warden';
export type SlotType = 'weapon' | 'shield' | 'support' | 'trade' | 'mining';
export type ModuleId =
  | 'lance'
  | 'scatter'
  | 'deflector'
  | 'regen'
  | 'plating'
  | 'pulse'
  | 'blink'
  | 'drone'
  | 'thrusters'
  | 'cargo'
  | 'broker'
  | 'drill'
  | 'bunker';

export type NodeKind = 'base' | 'planet' | 'station' | 'asteroid' | 'gasgiant';

export interface SectorNode {
  id: string;
  kind: NodeKind;
  name: string;
  hex: Hex;
  level: number; // planets: 0 = not colonized; gas giants: refinery level, 0 = none
  planetType?: 'rock' | 'garden';
  stock: number; // stations: trade goods waiting
  ore: number; // asteroids: ore left
}

export interface Ship {
  id: string;
  type: ShipType;
  name: string;
  location: 'home' | 'expedition' | 'coop'; // coop: away in a shared anomaly on the server
  pos: Vec;
  target: Vec | null; // where it is flying to, null when standing still
  heading: number; // radians, kept while standing
  hull: number;
  shield: number;
  lastHit: number;
  cargo: number; // home: trade goods (hauler) or ore (miner)
  cargoOrigin: string | null; // station the trade goods were loaded at
  shards: number; // expedition loot carried
  shuttle: { a: string; b: string } | null; // node ids to travel between automatically
  fit: Partial<Record<SlotType, ModuleId>>; // installed module per slot
  cooldowns: Partial<Record<ModuleId, number>>; // game time when an active module is ready again
}

export interface Job {
  kind: 'ship' | 'research' | 'beacon';
  target: string; // ship type, module id or tier
  remaining: number;
  total: number;
}

export type EnemyType = 'skirmisher' | 'colossus';

export interface Enemy {
  id: string;
  type: EnemyType;
  pos: Vec;
  target: Vec | null;
  heading: number;
  hp: number;
  maxHp: number;
  dps: number;
  stunnedUntil: number;
}

export interface Deposit {
  hex: Hex;
  shards: number;
}

export interface Expedition {
  tier: number;
  elapsed: number;
  duration: number;
  deposits: Deposit[];
  enemies: Enemy[];
  nextWave: number;
  waveIndex: number;
  banked: number;
  lost: number;
  shipIds: string[];
}

export interface ExpeditionResult {
  tier: number;
  banked: number;
  shipsLost: number;
  unlocked: boolean;
}

export interface LogEntry {
  t: number;
  msg: string;
}

export interface GameState {
  version: number;
  seed: number;
  time: number;
  credits: number;
  ore: number;
  shards: number;
  hydrogen: number; // fuel: ships burn it while flying at home, expeditions need it to jump
  nodes: SectorNode[];
  explored: string[]; // hex keys "q,r" of the home sector that are no longer hidden in the nebula
  ships: Ship[];
  blueprints: Record<ModuleId, number>; // researched level per module, 0 = locked
  hangar: number;
  queue: { ship: Job | null; research: Job | null; beacon: Job | null };
  beacons: Record<number, number>; // tier -> count
  maxTier: number;
  expedition: Expedition | null;
  coop?: { tier: number; shipIds: string[]; fuel: number; started: boolean } | null; // ships sent to a co-op anomaly
  lastResult: ExpeditionResult | null;
  nextId: number;
  kills: number;
  log: LogEntry[];
  savedAt: number; // epoch ms
}
