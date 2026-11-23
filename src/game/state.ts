import { CONFIG, MODULES } from './config';
import { shipStats } from './economy';
import { center, dist, parkingSpot } from './geom';
import { hex, hexDistance, hexKey, hexesInRadius, pixelToHex } from './hex';
import { makeRng } from './rng';
import type { GameState, Hex, LogEntry, SectorNode, Ship, ShipType, Vec } from './types';

const PLANET_NAMES = [
  'Veyra', 'Kessa', 'Orun', 'Talis', 'Myrr', 'Ondra', 'Pell', 'Sarn', 'Ivo', 'Tesh', 'Calder', 'Nimra',
  'Brask', 'Eloa', 'Fenn', 'Gaudi', 'Hollis', 'Juno', 'Karst', 'Lysa', 'Mavro', 'Nox',
];
const GAS_NAMES = ['Aru', 'Bellon', 'Corvax', 'Dravu', 'Eskar', 'Fyre'];
const STATION_NAMES = ['Posten Ilk', 'Posten Duna', 'Posten Rhee', 'Posten Varn', 'Posten Sol', 'Posten Tamm', 'Posten Ura', 'Posten Wend'];
const SHIP_NAMES = ['Kranich', 'Möwe', 'Falke', 'Elster', 'Reiher', 'Dohle', 'Milan', 'Lerche', 'Specht', 'Ibis'];

export function newGame(seed = Date.now() % 1_000_000): GameState {
  const s: GameState = {
    version: CONFIG.saveVersion,
    seed,
    time: 0,
    credits: CONFIG.start.credits,
    ore: CONFIG.start.ore,
    shards: CONFIG.start.shards,
    hydrogen: CONFIG.start.hydrogen,
    nodes: generateSector(seed),
    explored: hexesInRadius(CONFIG.sector.exploredRadius).map(hexKey),
    ships: [],
    blueprints: emptyBlueprints(),
    hangar: 0,
    queue: { ship: null, research: null, beacon: null },
    beacons: {},
    maxTier: 1,
    expedition: null,
    lastResult: null,
    nextId: 1,
    kills: 0,
    log: [],
    savedAt: Date.now(),
  };
  addShip(s, 'hauler');
  addShip(s, 'miner');
  log(s, 'Willkommen, Kommandant. Kolonisiere Planeten, handle zwischen Posten und baue Erz ab. Schiffe verbrauchen Wasserstoff – baue Raffinerien an Gasriesen.');
  return s;
}

function generateSector(seed: number): SectorNode[] {
  const rng = makeRng(seed);
  const { radius, planets, stations, asteroids, gasGiants } = CONFIG.sector;
  const free = rng.shuffle(hexesInRadius(radius).filter((h) => hexDistance(h, hex(0, 0)) > CONFIG.sector.exploredRadius));
  // the 6 visible hexes around the base get a guaranteed starter set, so there is something to do at once
  const starter = rng.shuffle(hexesInRadius(1).filter((h) => hexDistance(h, hex(0, 0)) === 1));
  const taken: Hex[] = [];
  const take = (start = false): Hex => {
    if (start && starter.length) {
      const h = starter.pop()!;
      taken.push(h);
      return h;
    }
    // prefer hexes not touching another node, fall back to any free hex
    const i = free.findIndex((h) => taken.every((t) => hexDistance(t, h) >= 2));
    const h = free.splice(i >= 0 ? i : 0, 1)[0];
    taken.push(h);
    return h;
  };
  const nodes: SectorNode[] = [
    { id: 'base', kind: 'base', name: 'Heimatbasis', hex: hex(0, 0), level: 1, stock: 0, ore: 0 },
  ];
  const pNames = rng.shuffle([...PLANET_NAMES]);
  for (let i = 0; i < planets; i++) {
    nodes.push({
      id: `p${i}`, kind: 'planet', name: pNames[i], hex: take(i < 2),
      level: 0, planetType: i % 2 === 0 ? 'garden' : 'rock', stock: 0, ore: 0,
    });
  }
  for (let i = 0; i < stations; i++) {
    nodes.push({ id: `s${i}`, kind: 'station', name: STATION_NAMES[i], hex: take(i < 2), level: 1, stock: 10, ore: 0 });
  }
  for (let i = 0; i < asteroids; i++) {
    nodes.push({
      id: `a${i}`, kind: 'asteroid', name: `Gürtel ${String.fromCharCode(65 + i)}`, hex: take(i < 1),
      level: 1, stock: 0, ore: CONFIG.asteroid.oreMax,
    });
  }
  for (let i = 0; i < gasGiants; i++) {
    nodes.push({ id: `g${i}`, kind: 'gasgiant', name: `Gasriese ${GAS_NAMES[i]}`, hex: take(i < 1), level: 0, stock: 0, ore: 0 });
  }
  return nodes;
}

export function addShip(s: GameState, type: ShipType): Ship {
  const st = shipStats(s, type);
  const n = s.nextId++;
  const ship: Ship = {
    id: `ship${n}`,
    type,
    name: `${SHIP_NAMES[(n - 1) % SHIP_NAMES.length]}${n > SHIP_NAMES.length ? ` ${Math.ceil(n / SHIP_NAMES.length)}` : ''}`,
    location: 'home',
    pos: { x: 0, y: 0 },
    target: null,
    heading: -Math.PI / 2,
    hull: st.hull,
    shield: st.shield,
    lastHit: -999,
    cargo: 0,
    cargoOrigin: null,
    shards: 0,
    shuttle: null,
    fit: {},
    cooldowns: {},
  };
  ship.pos = parkingSpot(center(baseNode(s).hex), ship.id, CONFIG.ranges.park);
  s.ships.push(ship);
  return ship;
}

export function emptyBlueprints(): GameState['blueprints'] {
  return Object.fromEntries(MODULES.map((m) => [m.id, 0])) as GameState['blueprints'];
}

export const isExplored = (s: GameState, h: Hex) => s.explored.includes(hexKey(h));

/** Reveal the hex a home-sector ship is in. Returns the newly found nodes, or null if it was known. */
export function exploreAt(s: GameState, p: Vec): SectorNode[] | null {
  const h = pixelToHex(p.x, p.y, CONFIG.hexSize);
  if (hexDistance(h, hex(0, 0)) > CONFIG.sector.radius) return null;
  const key = hexKey(h);
  if (s.explored.includes(key)) return null;
  s.explored.push(key);
  return s.nodes.filter((n) => hexKey(n.hex) === key);
}

export const baseNode = (s: GameState) => s.nodes.find((n) => n.kind === 'base')!;
export const nodeById = (s: GameState, id: string | null) => s.nodes.find((n) => n.id === id);
export const nodeAt = (s: GameState, h: Hex) => s.nodes.find((n) => n.hex.q === h.q && n.hex.r === h.r);

/** The node a position is docked at (within the dock range), if any. */
export function nodeNear(s: GameState, p: Vec, range: number = CONFIG.ranges.dock): SectorNode | undefined {
  let best: SectorNode | undefined;
  let bestD = range;
  for (const n of s.nodes) {
    const d = dist(center(n.hex), p);
    if (d <= bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}
export const shipById = (s: GameState, id: string | null) => s.ships.find((x) => x.id === id);

export function log(s: GameState, msg: string): void {
  const entry: LogEntry = { t: s.time, msg };
  s.log.unshift(entry);
  if (s.log.length > 40) s.log.length = 40;
}
