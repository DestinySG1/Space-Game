import { describe, expect, it } from 'vitest';
import * as A from '../src/game/actions';
import { CONFIG } from '../src/game/config';
import { colonizeCost, jumpFuel, passiveIncome, refineryCost, researchCost, shipStats } from '../src/game/economy';
import { GATE_POS, canJump, expeditionShips } from '../src/game/expedition';
import { center, dist } from '../src/game/geom';
import { hex, hexDistance, hexLine, hexesInRadius, pixelToHex, hexToPixel } from '../src/game/hex';
import { load, save, simulateOffline, step } from '../src/game/sim';
import { addShip, isExplored, newGame } from '../src/game/state';

const stations = (s: ReturnType<typeof newGame>) => s.nodes.filter((n) => n.kind === 'station');

describe('hex math', () => {
  it('measures distance and draws lines of the right length', () => {
    expect(hexDistance(hex(0, 0), hex(2, -1))).toBe(2);
    const line = hexLine(hex(0, 0), hex(3, -1));
    expect(line).toHaveLength(3);
    expect(line[2]).toEqual(hex(3, -1));
  });
  it('round-trips pixels and counts hexes', () => {
    for (const h of hexesInRadius(3)) {
      const p = hexToPixel(h, 20);
      expect(pixelToHex(p.x, p.y, 20)).toEqual(h);
    }
    expect(hexesInRadius(4)).toHaveLength(61);
  });
});

describe('sector', () => {
  it('generates the same sector from the same seed with unique node positions', () => {
    const a = newGame(42);
    const b = newGame(42);
    expect(a.nodes).toEqual(b.nodes);
    const keys = new Set(a.nodes.map((n) => `${n.hex.q},${n.hex.r}`));
    expect(keys.size).toBe(a.nodes.length);
  });
});

describe('home economy', () => {
  it('colonies produce credits over time and get pricier', () => {
    const s = newGame(1);
    const planet = s.nodes.find((n) => n.kind === 'planet' && n.planetType === 'garden')!;
    const first = colonizeCost(s).credits;
    expect(A.colonize(s, planet.id).ok).toBe(true);
    expect(colonizeCost(s).credits).toBeGreaterThan(first);
    const before = s.credits;
    step(s, 60);
    expect(s.credits - before).toBeCloseTo(CONFIG.planet.garden.credits * 60, 0);
  });

  it('a shuttling hauler earns credits between two stations', () => {
    const s = newGame(2);
    const [a, b] = stations(s);
    const hauler = s.ships.find((x) => x.type === 'hauler')!;
    hauler.pos = center(a.hex);
    step(s, 0.1); // loads goods
    expect(hauler.cargo).toBeGreaterThan(0);
    expect(A.setShuttle(s, hauler.id, b.id).ok).toBe(true);
    const before = s.credits;
    step(s, 600);
    expect(s.credits).toBeGreaterThan(before + 200);
  });

  it('a shuttling miner brings ore to the base', () => {
    const s = newGame(3);
    const field = s.nodes.find((n) => n.kind === 'asteroid')!;
    const miner = s.ships.find((x) => x.type === 'miner')!;
    expect(A.setShuttle(s, miner.id, field.id).ok).toBe(true);
    const before = s.ore;
    step(s, 900);
    expect(s.ore).toBeGreaterThan(before + 60);
  });

  it('research costs shards from level 2 and applies its bonus', () => {
    const s = newGame(4);
    s.credits = 1e6;
    expect(researchCost(s, 'drillHead').shards).toBe(0);
    const base = shipStats(s, 'miner').mineHome;
    expect(A.research(s, 'drillHead').ok).toBe(true);
    step(s, researchCost(s, 'drillHead').time + 60);
    expect(s.modules.drillHead).toBe(1);
    expect(shipStats(s, 'miner').mineHome).toBeCloseTo(base * 1.25);
    expect(researchCost(s, 'drillHead').shards).toBeGreaterThan(0);
    expect(A.research(s, 'drillHead').ok).toBe(false); // no shards yet
  });

  it('respects hangar slots', () => {
    const s = newGame(5);
    s.credits = 1e6;
    s.ore = 1e6;
    addShip(s, 'warden'); // 3 of 3
    expect(A.buildShip(s, 'hauler').ok).toBe(false);
    expect(A.upgradeHangar(s).ok).toBe(true);
    expect(A.buildShip(s, 'hauler').ok).toBe(true);
  });
});

describe('exploration', () => {
  it('starts with the base and its 6 neighbours visible and a starter set inside', () => {
    const s = newGame(40);
    expect(s.explored).toHaveLength(7);
    const inner = s.nodes.filter((n) => isExplored(s, n.hex) && n.kind !== 'base');
    const kinds = inner.map((n) => n.kind).sort();
    expect(kinds).toEqual(['asteroid', 'gasgiant', 'planet', 'planet', 'station', 'station']);
  });

  it('a ship flying into the nebula reveals the hex and what is in it', () => {
    const s = newGame(41);
    const hidden = s.nodes.find((n) => !isExplored(s, n.hex))!;
    s.credits = 1e6;
    expect(A.colonize(s, hidden.id).ok).toBe(false); // hidden in the nebula
    const ship = s.ships[0];
    A.moveShip(s, ship.id, center(hidden.hex));
    step(s, 300);
    expect(isExplored(s, hidden.hex)).toBe(true);
    expect(s.log.some((l) => l.msg.includes(hidden.name))).toBe(true);
  });

  it('only offers explored destinations for shuttle routes', () => {
    const s = newGame(42);
    const hauler = s.ships.find((x) => x.type === 'hauler')!;
    const st = s.nodes.find((n) => n.kind === 'station' && isExplored(s, n.hex))!;
    hauler.pos = center(st.hex);
    const targets = A.shuttleTargets(s, hauler.id);
    expect(targets.length).toBeGreaterThan(0);
    for (const id of targets) expect(isExplored(s, s.nodes.find((n) => n.id === id)!.hex)).toBe(true);
  });
});

describe('hydrogen', () => {
  it('flying burns hydrogen, standing still does not', () => {
    const s = newGame(30);
    const ship = s.ships[0];
    s.hydrogen = 100;
    const base = CONFIG.hydrogen.baseOutput;
    step(s, 10);
    expect(s.hydrogen).toBeCloseTo(100 + base * 10, 6);
    A.moveShip(s, ship.id, { x: ship.pos.x + 20, y: ship.pos.y });
    const before = s.hydrogen;
    step(s, 30);
    expect(ship.target).toBeNull();
    expect(before + base * 30 - s.hydrogen).toBeCloseTo(20 * CONFIG.hydrogen.burn[ship.type], 3);
  });

  it('an empty tank slows ships to a crawl but does not stop them', () => {
    const s = newGame(31);
    const ship = s.ships[0];
    s.hydrogen = 0;
    const start = { ...ship.pos };
    A.moveShip(s, ship.id, { x: start.x + 30, y: start.y });
    step(s, 1);
    const moved = dist(start, ship.pos);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(shipStats(s, ship.type).speedHome * 0.3);
  });

  it('refineries on gas giants produce hydrogen and get pricier', () => {
    const s = newGame(32);
    s.credits = 1e6;
    s.ore = 1e6;
    const gg = s.nodes.filter((n) => n.kind === 'gasgiant');
    expect(gg).toHaveLength(CONFIG.sector.gasGiants);
    const first = refineryCost(s).credits;
    expect(A.buildRefinery(s, gg[0].id).ok).toBe(true);
    expect(refineryCost(s).credits).toBeGreaterThan(first);
    expect(A.upgradeRefinery(s, gg[0].id).ok).toBe(true);
    expect(passiveIncome(s).hydrogen).toBeCloseTo(CONFIG.hydrogen.baseOutput + CONFIG.hydrogen.output * 2 ** CONFIG.hydrogen.exponent);
  });

  it('an expedition needs jump fuel for every ship', () => {
    const s = newGame(33);
    s.beacons[1] = 1;
    const ids = s.ships.map((x) => x.id);
    s.hydrogen = jumpFuel(1, ids.length) - 1;
    expect(A.launchExpedition(s, 1, ids, 1).ok).toBe(false);
    s.hydrogen += 1;
    expect(A.launchExpedition(s, 1, ids, 1).ok).toBe(true);
    expect(s.hydrogen).toBeCloseTo(0);
  });
});

describe('free flight', () => {
  it('flies to any point on the map, stops there and stays still', () => {
    const s = newGame(20);
    const ship = s.ships[0];
    const to = { x: 3.3, y: -2.1 }; // not a hex centre
    expect(A.moveShip(s, ship.id, to).ok).toBe(true);
    step(s, 120);
    expect(dist(ship.pos, to)).toBeLessThan(1e-9);
    expect(ship.target).toBeNull();
    const rest = { ...ship.pos };
    step(s, 30);
    expect(ship.pos).toEqual(rest);
  });

  it('refuses points outside the sector and parks ships on separate spots', () => {
    const s = newGame(21);
    expect(A.moveShip(s, s.ships[0].id, { x: 100, y: 0 }).ok).toBe(false);
    expect(dist(s.ships[0].pos, s.ships[1].pos)).toBeGreaterThan(0.05);
  });

  it('enemies keep a firing distance instead of stacking on a ship', () => {
    const s = newGame(22);
    s.beacons[1] = 1;
    const w = addShip(s, 'warden');
    A.launchExpedition(s, 1, [w.id], 23);
    step(s, CONFIG.expedition.firstWave + 30);
    for (const en of s.expedition!.enemies) expect(dist(en.pos, w.pos)).toBeGreaterThan(0.5);
  });
});

describe('expedition', () => {
  function ready(seed: number) {
    const s = newGame(seed);
    s.credits = 1e6;
    s.ore = 1e6;
    s.beacons[1] = 1;
    return s;
  }

  it('needs a beacon and moves ships to the gate', () => {
    const s = ready(6);
    s.beacons[1] = 0;
    const ids = s.ships.map((x) => x.id);
    expect(A.launchExpedition(s, 1, ids).ok).toBe(false);
    s.beacons[1] = 1;
    expect(A.launchExpedition(s, 1, ids, 7).ok).toBe(true);
    expect(expeditionShips(s).every(canJump)).toBe(true);
  });

  it('banks mined shards on jump and unlocks the next tier', () => {
    const s = ready(8);
    const miner = s.ships.find((x) => x.type === 'miner')!;
    A.launchExpedition(s, 1, [miner.id], 9);
    const dep = s.expedition!.deposits[0];
    miner.pos = center(dep.hex);
    step(s, 30); // before the first wave
    expect(miner.shards).toBeGreaterThan(0);
    miner.shards = 30; // pretend it filled up
    miner.pos = { ...GATE_POS };
    expect(A.jump(s, miner.id).ok).toBe(true);
    expect(s.shards).toBe(30);
    expect(s.expedition).toBeNull();
    expect(s.maxTier).toBe(2);
    expect(miner.location).toBe('home');
  });

  it('loses every ship still inside when the timer runs out', () => {
    const s = ready(10);
    const ids = s.ships.map((x) => x.id);
    A.launchExpedition(s, 1, ids, 11);
    step(s, CONFIG.expedition.duration + 1);
    expect(s.expedition).toBeNull();
    expect(s.ships).toHaveLength(0);
    expect(s.lastResult?.shipsLost).toBe(2);
  });

  it('enemies attack and a warden kills them', () => {
    const s = ready(12);
    const w = addShip(s, 'warden');
    A.launchExpedition(s, 1, [w.id], 13);
    step(s, CONFIG.expedition.firstWave + 60);
    expect(s.kills).toBeGreaterThan(0);
  });
});

describe('saving', () => {
  it('saves, loads and simulates offline time for the home sector only', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const s = newGame(14);
    A.colonize(s, s.nodes.find((n) => n.kind === 'planet')!.id);
    save(s, storage);
    const parsed = JSON.parse(mem.get(CONFIG.saveKey)!);
    parsed.savedAt -= 3600 * 1000;
    mem.set(CONFIG.saveKey, JSON.stringify(parsed));
    const { state, offline } = load(storage);
    expect(offline).toBeCloseTo(3600, -1);
    expect(state.credits).toBeGreaterThan(s.credits);
    expect(simulateOffline(state, 1e9)).toBe(CONFIG.offlineCapSeconds);
  });
});
