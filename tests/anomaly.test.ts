import { describe, expect, it } from 'vitest';
import {
  GATE_POS, createRun, canJumpRun, joinRun, jumpShip, moveShip, offerStats, tickRun, useAbility, type ShipOffer,
} from '../src/game/anomaly';
import { CONFIG } from '../src/game/config';
import { center, dist } from '../src/game/geom';

const offer = (id: string, type: ShipOffer['type'], extra: Partial<ShipOffer> = {}): ShipOffer => ({
  id, type, name: id, fit: {}, levels: {}, ...extra,
});

function run(seed = 1, tier = 1, players = 2) {
  return createRun('r', tier, seed, players);
}

describe('co-op anomaly', () => {
  it('has more deposits with more players and is deterministic per seed', () => {
    expect(run(1, 1, 3).deposits.length).toBeGreaterThan(run(1, 1, 1).deposits.length);
    expect(run(7).deposits).toEqual(run(7).deposits);
  });

  it('computes ship stats on the server and ignores impossible offers', () => {
    const honest = offerStats(offer('a', 'warden', { fit: { weapon: 'lance' }, levels: { lance: 5 } }));
    const cheat = offerStats(offer('a', 'warden', { fit: { weapon: 'lance' }, levels: { lance: 99 } }));
    expect(cheat.dps).toBeCloseTo(honest.dps); // levels are capped at the maximum
    const wrongSlot = offerStats(offer('a', 'warden', { fit: { weapon: 'deflector' as never }, levels: { deflector: 5 } }));
    expect(wrongSlot.shield).toBeCloseTo(offerStats(offer('a', 'warden')).shield);
  });

  it('only the owner can steer a ship; a jump banks the shards for its owner', () => {
    const r = run();
    joinRun(r, 'Anna', [offer('m1', 'miner')]);
    joinRun(r, 'Bernd', [offer('w1', 'warden')]);
    expect(moveShip(r, 'Bernd', 'm1', { x: 5, y: 0 })).toBe(false);
    const miner = r.ships.find((x) => x.id === 'm1')!;
    miner.shards = 12.7;
    miner.pos = { ...GATE_POS };
    expect(canJumpRun(miner)).toBe(true);
    expect(jumpShip(r, 'Anna', 'm1')).toBe(true);
    expect(r.events).toContainEqual({ t: 'returned', owner: 'Anna', shipId: 'm1', shards: 12, hull: miner.hull });
    expect(r.players.find((p) => p.name === 'Anna')!.banked).toBe(12);
  });

  it("one player's warden protects another player's miner", () => {
    const r = run(3);
    joinRun(r, 'Anna', [offer('m1', 'miner')]);
    joinRun(r, 'Bernd', [offer('w1', 'warden')]);
    const miner = r.ships.find((x) => x.id === 'm1')!;
    const warden = r.ships.find((x) => x.id === 'w1')!;
    miner.pos = { x: 0, y: 0 };
    warden.pos = { x: 1, y: 0 };
    r.enemies.push({ id: 'x', type: 'skirmisher', pos: { x: -2.5, y: 0 }, target: null, heading: 0, hp: 1e6, maxHp: 1e6, dps: 20, stunnedUntil: 0 });
    for (let i = 0; i < 30; i++) tickRun(r, 0.1);
    expect(miner.hull + miner.shield).toBe(miner.stats.hull + miner.stats.shield);
    expect(warden.hull + warden.shield).toBeLessThan(warden.stats.hull + warden.stats.shield);
  });

  it('miners mine deposits and the disruption pulse freezes enemies', () => {
    const r = run(4);
    joinRun(r, 'Anna', [offer('m1', 'miner'), offer('w1', 'warden', { fit: { support: 'pulse' }, levels: { pulse: 1 } })]);
    const miner = r.ships.find((x) => x.id === 'm1')!;
    miner.pos = center(r.deposits[0].hex);
    tickRun(r, 10);
    expect(miner.shards).toBeGreaterThan(0);
    const w = r.ships.find((x) => x.id === 'w1')!;
    r.enemies.push({ id: 'x', type: 'skirmisher', pos: { x: w.pos.x + 3, y: w.pos.y }, target: null, heading: 0, hp: 1e6, maxHp: 1e6, dps: 0, stunnedUntil: 0 });
    expect(useAbility(r, 'Anna', 'w1')).toBe(true);
    expect(useAbility(r, 'Anna', 'w1')).toBe(false); // cooldown
    expect(r.enemies[0].stunnedUntil).toBeGreaterThan(r.time);
  });

  it('collapses after the timer, losing every ship still inside', () => {
    const r = run(5);
    joinRun(r, 'Anna', [offer('h1', 'hauler')]);
    joinRun(r, 'Bernd', [offer('h2', 'hauler')]);
    for (let t = 0; t < CONFIG.expedition.duration + 1 && !r.ended; t += 0.5) tickRun(r, 0.5);
    expect(r.ended).toBe(true);
    expect(r.ships).toHaveLength(0);
    expect(r.events.filter((e) => e.t === 'lost')).toHaveLength(2);
    expect(r.events.at(-1)).toEqual({ t: 'end' });
  });

  it('spawns more enemies per wave with more players', () => {
    const solo = run(6, 1, 1);
    joinRun(solo, 'A', [offer('w', 'warden')]);
    const group = run(6, 1, 4);
    for (const n of ['A', 'B', 'C', 'D']) joinRun(group, n, [offer('w', 'warden')]);
    for (const r of [solo, group]) for (let t = 0; t < CONFIG.expedition.firstWave + 0.5; t += 0.5) tickRun(r, 0.5);
    const count = (r: typeof solo) => (r.events.find((e) => e.t === 'wave') as { count: number }).count;
    expect(count(group)).toBeGreaterThan(count(solo));
    expect(dist(group.ships[0].pos, GATE_POS)).toBeLessThan(5);
  });
});
