// Balance probe: a simple bot plays the home sector and prints milestones.
// Run with: npx vite-node scripts/balance.ts
import * as A from '../src/game/actions';
import { colonizeCost, canAfford, passiveIncome, planetUpgradeCost, refineryCost, shipCost } from '../src/game/economy';
import { step } from '../src/game/sim';
import { newGame } from '../src/game/state';
import { hexDistance } from '../src/game/hex';
import { center } from '../src/game/geom';

const s = newGame(1234);
const stations = s.nodes.filter((n) => n.kind === 'station');
// farthest pair of stations for the hauler
let pair = [stations[0], stations[1]];
for (const a of stations) for (const b of stations) if (hexDistance(a.hex, b.hex) > hexDistance(pair[0].hex, pair[1].hex)) pair = [a, b];
const hauler = s.ships.find((x) => x.type === 'hauler')!;
const miner = s.ships.find((x) => x.type === 'miner')!;
A.moveShip(s, hauler.id, center(pair[0].hex));
A.setShuttle(s, miner.id, s.nodes.find((n) => n.kind === 'asteroid')!.id);

const milestones: string[] = [];
const mark = (m: string) => milestones.push(`${(s.time / 60).toFixed(1).padStart(6)} min  ${m}`);
let shuttleSet = false;
let warden = false;
let beacon = false;

for (let t = 0; t < 4 * 3600; t += 5) {
  step(s, 5);
  if (!shuttleSet && !hauler.target) {
    A.setShuttle(s, hauler.id, pair[1].id);
    shuttleSet = true;
  }
  // keep the tank from running dry: build a refinery when hydrogen gets low
  const gas = s.nodes.find((n) => n.kind === 'gasgiant' && n.level === 0);
  if (s.hydrogen < 40 && gas && canAfford(s, refineryCost(s))) {
    A.buildRefinery(s, gas.id);
    mark(`Raffinerie an ${gas.name} (H₂ war ${Math.floor(s.hydrogen)})`);
  }
  // colonize gardens first, then rocks; upgrade cheapest planet otherwise
  const free = s.nodes.filter((n) => n.kind === 'planet' && n.level === 0).sort((a) => (a.planetType === 'garden' ? -1 : 1));
  if (free.length && canAfford(s, colonizeCost(s)) && (warden || s.credits > 1500)) {
    A.colonize(s, free[0].id);
    mark(`kolonisiert ${free[0].name} (${free[0].planetType})`);
  }
  if (!warden && canAfford(s, shipCost('warden'))) {
    A.buildShip(s, 'warden');
    warden = true;
    mark('Wächter in Bau');
  }
  if (warden && !beacon && A.craftBeacon(s, 1).ok) {
    beacon = true;
    mark('Sprungkern 1 in Arbeit → erste Expedition möglich');
  }
  const owned = s.nodes.filter((n) => n.kind === 'planet' && n.level > 0).sort((a, b) => a.level - b.level);
  if (beacon && owned.length && canAfford(s, planetUpgradeCost(owned[0])) && s.credits > 3000) A.upgradePlanet(s, owned[0].id);
  if (t % 600 === 0 && t > 0 && t <= 3600) mark(`H₂ ${Math.floor(s.hydrogen)}`);
  if (t % 1800 === 0 && t > 0) {
    const inc = passiveIncome(s);
    mark(`Credits ${Math.floor(s.credits)} · Erz ${Math.floor(s.ore)} · H₂ ${Math.floor(s.hydrogen)} · Kolonien/min ${Math.round(inc.credits * 60)} cr ${Math.round(inc.ore * 60)} erz ${Math.round(inc.hydrogen * 60)} H₂`);
  }
}
console.log(milestones.join('\n'));
