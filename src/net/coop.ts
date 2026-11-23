// Client side of co-op anomalies: WebSocket to the player's server, queue, live run and rewards.
import { canAfford, jumpFuel, unlockThreshold } from '../game/economy';
import type { RunSnapshot, ShipOffer } from '../game/anomaly';
import { CONFIG, moduleInfo } from '../game/config';
import { parkingSpot } from '../game/geom';
import { basePos } from '../game/home';
import { log, shipById } from '../game/state';
import type { GameState, ModuleId, Ship, Vec } from '../game/types';

export interface CoopView {
  status: 'off' | 'connecting' | 'idle' | 'queued' | 'running';
  queued: { tier: number; waiting: number; startsIn: number } | null;
  snap: RunSnapshot | null;
  snapAt: number; // performance.now() when the snapshot arrived
  me: string | null;
  lastEnd: { tier: number; banked: number; lost: number; players: { name: string; banked: number; lost: number }[] } | null;
  msg: string;
}

/** What the server needs to know about a ship; it computes the stats itself. */
export function offerFor(s: GameState, ship: Ship): ShipOffer {
  const levels: ShipOffer['levels'] = {};
  for (const id of Object.values(ship.fit) as ModuleId[]) levels[id] = s.blueprints[id];
  return { id: ship.id, type: ship.type, name: ship.name, fit: { ...ship.fit }, levels };
}

export class Coop {
  view: CoopView = { status: 'off', queued: null, snap: null, snapAt: 0, me: null, lastEnd: null, msg: '' };
  private ws: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  onStart: (() => void) | null = null; // e.g. switch the view to the co-op map

  constructor(
    private token: () => string | null,
    private game: () => GameState,
    private changed: () => void,
    private notify: (msg: string, ok: boolean) => void,
  ) {}

  private set(patch: Partial<CoopView>) {
    Object.assign(this.view, patch);
    this.changed();
  }

  /** Open (or keep) the connection while signed in. Safe to call often. */
  connect() {
    if (this.ws || !this.token()) return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return;
    }
    this.ws = ws;
    this.set({ status: 'connecting' });
    ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'auth', token: this.token() })));
    ws.addEventListener('message', (e) => this.onMessage(JSON.parse(String(e.data))));
    ws.addEventListener('close', () => {
      this.ws = null;
      this.set({ status: 'off' });
      if (this.token() && !this.retry) this.retry = setTimeout(() => ((this.retry = null), this.connect()), 3000);
    });
  }

  disconnect() {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.set({ status: 'off', snap: null, queued: null });
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  // ---- player actions -----------------------------------------------------------------

  /** Spend a beacon and jump fuel, send the ships away and join the queue for this tier. */
  queue(tier: number, shipIds: string[]): string | null {
    const s = this.game();
    if (this.view.status !== 'idle') return 'Keine Verbindung zum Server oder schon unterwegs.';
    if (s.expedition || s.coop) return 'Es läuft bereits eine Expedition.';
    if ((s.beacons[tier] ?? 0) < 1) return `Kein Sprungkern der Stufe ${tier} vorhanden.`;
    const ships = shipIds.map((id) => shipById(s, id)).filter((x): x is Ship => !!x && x.location === 'home');
    if (!ships.length) return 'Wähle mindestens ein Schiff.';
    const fuel = jumpFuel(tier, ships.length);
    if (!canAfford(s, { credits: 0, ore: 0, shards: 0, hydrogen: fuel })) return `Zu wenig Wasserstoff: Der Sprung braucht ${fuel}.`;
    s.beacons[tier] -= 1;
    s.hydrogen -= fuel;
    for (const ship of ships) {
      ship.location = 'coop';
      ship.target = null;
      ship.shuttle = null;
      ship.cargo = 0;
      ship.cargoOrigin = null;
    }
    s.coop = { tier, shipIds: ships.map((x) => x.id), fuel, started: false };
    this.send({ t: 'queue', tier, ships: ships.map((x) => offerFor(s, x)) });
    this.set({ status: 'queued', queued: { tier, waiting: 1, startsIn: 20 } });
    log(s, `Koop-Anomalie Stufe ${tier}: Suche nach Mitspielern …`);
    return null;
  }

  cancel() {
    this.send({ t: 'cancel' });
  }
  move(shipId: string, to: Vec) {
    this.send({ t: 'move', id: shipId, x: to.x, y: to.y });
  }
  jump(shipId: string) {
    this.send({ t: 'jump', id: shipId });
  }
  ability(shipId: string) {
    this.send({ t: 'ability', id: shipId });
  }

  // ---- server messages ----------------------------------------------------------------

  private bringHome(s: GameState, ship: Ship) {
    ship.location = 'home';
    ship.pos = parkingSpot(basePos(s), ship.id, CONFIG.ranges.park);
    ship.target = null;
  }

  private onMessage(m: Record<string, unknown>) {
    const s = this.game();
    switch (m.t) {
      case 'authed': {
        this.set({ status: s.coop ? 'queued' : 'idle', me: String(m.name), msg: '' });
        const away = s.ships.filter((x) => x.location === 'coop').map((x) => x.id);
        this.send({ t: 'hello', shipIds: away });
        if (!away.length && s.coop) s.coop = null;
        if (!s.coop) this.set({ status: 'idle' });
        return;
      }
      case 'queued':
        this.set({ status: 'queued', queued: { tier: Number(m.tier), waiting: Number(m.waiting), startsIn: Number(m.startsIn) } });
        return;
      case 'cancelled':
      case 'orphans': {
        const ids = (m.shipIds as string[]) ?? [];
        for (const id of ids) {
          const ship = shipById(s, id);
          if (ship?.location === 'coop') this.bringHome(s, ship);
        }
        if (m.t === 'cancelled' && s.coop && !s.coop.started) {
          // nothing happened yet: beacon and fuel come back
          s.beacons[s.coop.tier] = (s.beacons[s.coop.tier] ?? 0) + 1;
          s.hydrogen += s.coop.fuel;
          log(s, 'Koop-Suche abgebrochen. Sprungkern und Treibstoff zurück.');
        } else if (m.t === 'orphans') {
          log(s, `${ids.length} Schiff(e) aus einer beendeten Koop-Anomalie zurückgekehrt.`);
        }
        if (!s.ships.some((x) => x.location === 'coop')) s.coop = null;
        this.set({ status: 'idle', queued: null, snap: null });
        return;
      }
      case 'start':
        if (s.coop) s.coop.started = true;
        this.set({ status: 'running', queued: null, snap: m.snap as RunSnapshot, snapAt: performance.now() });
        this.notify(`Koop-Anomalie Stufe ${m.tier} beginnt!`, true);
        this.onStart?.();
        return;
      case 'snap':
        this.set({ snap: m.snap as RunSnapshot, snapAt: performance.now() });
        return;
      case 'returned': {
        const ship = shipById(s, String(m.shipId));
        if (!ship) return;
        this.bringHome(s, ship);
        ship.hull = Math.max(1, Number(m.hull) || 1);
        const shards = Number(m.shards) || 0;
        s.shards += shards;
        log(s, `Koop: ${ship.name} ist zurück und bringt ${shards} Splitter mit.`);
        this.notify(`${ship.name}: ${shards} Splitter gesichert.`, true);
        return;
      }
      case 'lost': {
        const ship = shipById(s, String(m.shipId));
        if (!ship) return;
        s.ships = s.ships.filter((x) => x !== ship);
        log(s, `Koop: ${ship.name} ${m.reason === 'collapse' ? 'ist im Kollaps verloren gegangen' : 'wurde zerstört'}.`);
        return;
      }
      case 'end': {
        const players = (m.players as { name: string; banked: number; lost: number }[]) ?? [];
        const mine = players.find((p) => p.name === this.view.me) ?? { banked: 0, lost: 0 };
        const tier = Number(m.tier);
        if (tier === s.maxTier && mine.banked >= unlockThreshold(tier)) {
          s.maxTier += 1;
          log(s, `Stufe ${s.maxTier} freigeschaltet!`);
        }
        // anything still marked as away was lost with the collapse
        s.ships = s.ships.filter((x) => x.location !== 'coop');
        s.coop = null;
        log(s, `Koop-Anomalie Stufe ${tier} beendet: ${mine.banked} Splitter gesichert, ${mine.lost} Schiff(e) verloren.`);
        this.set({ status: 'idle', snap: null, lastEnd: { tier, banked: mine.banked, lost: mine.lost, players } });
        return;
      }
      case 'error':
        this.set({ msg: String(m.msg) });
        this.notify(String(m.msg), false);
        return;
    }
  }

  /** Name of an active module for the button label. */
  static abilityName(id: ModuleId) {
    return moduleInfo(id).name;
  }
}
