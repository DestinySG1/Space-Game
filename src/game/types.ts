export interface Hex {
  q: number;
  r: number;
}

export type ShipType = 'hauler' | 'miner' | 'warden';
export type ModuleId =
  | 'cargoBay'
  | 'tradeLink'
  | 'drillHead'
  | 'engines'
  | 'armor'
  | 'shields'
  | 'cannons'
  | 'scanner';

export type NodeKind = 'base' | 'planet' | 'station' | 'asteroid';

export interface SectorNode {
  id: string;
  kind: NodeKind;
  name: string;
  hex: Hex;
  level: number; // planets: 0 = not colonized
  planetType?: 'rock' | 'garden';
  stock: number; // stations: trade goods waiting
  ore: number; // asteroids: ore left
}

export interface Ship {
  id: string;
  type: ShipType;
  name: string;
  location: 'home' | 'expedition';
  hex: Hex;
  path: Hex[];
  progress: number; // 0..1 along the way to path[0]
  hull: number;
  shield: number;
  lastHit: number;
  cargo: number; // home: trade goods (hauler) or ore (miner)
  cargoOrigin: string | null; // station the trade goods were loaded at
  shards: number; // expedition loot carried
  shuttle: { a: string; b: string } | null; // node ids to travel between automatically
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
  hex: Hex;
  path: Hex[];
  progress: number;
  hp: number;
  maxHp: number;
  dps: number;
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
  nodes: SectorNode[];
  ships: Ship[];
  modules: Record<ModuleId, number>;
  hangar: number;
  queue: { ship: Job | null; research: Job | null; beacon: Job | null };
  beacons: Record<number, number>; // tier -> count
  maxTier: number;
  expedition: Expedition | null;
  lastResult: ExpeditionResult | null;
  nextId: number;
  kills: number;
  log: LogEntry[];
  savedAt: number; // epoch ms
}
