// Expedition probe: a fleet parks on the nearest deposit, mines, and returns before the collapse.
// Run with: npx vite-node scripts/expedition-probe.ts
import * as A from '../src/game/actions';
import { CONFIG } from '../src/game/config';
import { GATE, expeditionShips } from '../src/game/expedition';
import { hexDistance } from '../src/game/hex';
import { step } from '../src/game/sim';
import { addShip, newGame } from '../src/game/state';
import type { ShipType } from '../src/game/types';

function run(tier: number, fleet: ShipType[], research = 0, seed = 1) {
  const s = newGame(seed);
  s.ships = [];
  for (const k of Object.keys(s.modules) as (keyof typeof s.modules)[]) s.modules[k] = research;
  const ids = fleet.map((t) => addShip(s, t).id);
  s.beacons[tier] = 1;
  s.maxTier = tier;
  A.launchExpedition(s, tier, ids, seed * 7);
  const ex = s.expedition!;
  const dep = [...ex.deposits].sort((a, b) => hexDistance(a.hex, GATE) - hexDistance(b.hex, GATE))[0];
  for (const sh of expeditionShips(s)) A.moveShip(s, sh.id, dep.hex);
  let recalled = false;
  while (s.expedition) {
    step(s, 1);
    const e = s.expedition;
    if (!e) break;
    // move to the next deposit when this one runs dry
    const cur = e.deposits.find((d) => d.hex.q === expeditionShips(s)[0]?.hex.q && d.hex.r === expeditionShips(s)[0]?.hex.r);
    if (!recalled && cur && cur.shards <= 0) {
      const next = [...e.deposits].filter((d) => d.shards > 0).sort((a, b) => hexDistance(a.hex, cur.hex) - hexDistance(b.hex, cur.hex))[0];
      if (next) for (const sh of expeditionShips(s)) A.moveShip(s, sh.id, next.hex);
    }
    if (!recalled && e.duration - e.elapsed < 150) {
      A.recallAllToGate(s);
      recalled = true;
    }
    if (recalled) A.jumpAllAtGate(s);
  }
  const r = s.lastResult!;
  const deaths = s.log.filter((l) => /zerstört|verloren/.test(l.msg) && !/beendet/.test(l.msg)).map((l) => Math.round(l.t)).reverse();
  return `T${tier} research ${research} [${fleet.join(',')}]: banked ${r.banked}, lost ${r.shipsLost}/${fleet.length}, kills ${s.kills}, deaths at ${deaths.join('/') || '-'}s`;
}

const out: string[] = [];
for (const seed of [1, 2]) {
  out.push(run(1, ['miner', 'hauler'], 0, seed));
  out.push(run(1, ['warden', 'miner', 'hauler'], 0, seed));
  out.push(run(2, ['warden', 'miner', 'hauler'], 0, seed));
  out.push(run(3, ['warden', 'miner', 'hauler'], 0, seed));
  out.push(run(3, ['warden', 'warden', 'miner', 'hauler'], 2, seed));
  out.push(run(5, ['warden', 'warden', 'miner', 'hauler'], 3, seed));
}
console.log(`duration ${CONFIG.expedition.duration}s\n` + out.join('\n'));
