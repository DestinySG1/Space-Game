// Co-op hub: matchmaking per tier, authoritative anomaly simulation, WebSocket messaging.
import { randomBytes } from 'node:crypto';
import {
  MAX_PLAYERS, createRun, joinRun, jumpShip, moveShip, snapshot, tickRun, useAbility, type Run, type ShipOffer,
} from '../../src/game/anomaly';
import { CONFIG } from '../../src/game/config';

/** Minimal socket interface (satisfied by the `ws` WebSocket and by test doubles). */
export interface Socket {
  send(data: string): void;
  close(): void;
  readyState: number;
}

interface Entry {
  name: string;
  tier: number;
  offers: ShipOffer[];
  since: number;
}

export interface HubOptions {
  matchWaitMs?: number; // start alone (or with whoever is waiting) after this long
  groupDelayMs?: number; // with 2+ players waiting, start after this long
  tickMs?: number;
  snapEvery?: number; // send a snapshot every n ticks
  now?: () => number;
}

export class CoopHub {
  private queue: Entry[] = [];
  private runs = new Map<string, Run>();
  private playerRun = new Map<string, string>();
  private sockets = new Map<string, Set<Socket>>();
  private pending = new Map<string, object[]>(); // messages for players who are offline right now
  private ticks = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly o: Required<HubOptions>;

  constructor(opts: HubOptions = {}) {
    this.o = { matchWaitMs: 20_000, groupDelayMs: 5_000, tickMs: 100, snapEvery: 2, now: Date.now, ...opts };
  }

  start() {
    this.timer ??= setInterval(() => this.step(this.o.tickMs / 1000), this.o.tickMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ---- connections ------------------------------------------------------------------

  connect(name: string, ws: Socket) {
    const set = this.sockets.get(name) ?? new Set();
    set.add(ws);
    this.sockets.set(name, set);
    for (const msg of this.pending.get(name) ?? []) this.sendTo(ws, msg);
    this.pending.delete(name);
  }

  disconnect(name: string, ws: Socket) {
    this.sockets.get(name)?.delete(ws);
  }

  private sendTo(ws: Socket, msg: object) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  /** Deliver to every open socket of a player, or keep it until they come back. */
  private tell(name: string, msg: object, keep = true) {
    const open = [...(this.sockets.get(name) ?? [])].filter((s) => s.readyState === 1);
    if (open.length) for (const ws of open) this.sendTo(ws, msg);
    else if (keep) this.pending.set(name, [...(this.pending.get(name) ?? []), msg]);
  }

  // ---- messages from a signed-in client ------------------------------------------------

  handle(name: string, ws: Socket, raw: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const run = this.runs.get(this.playerRun.get(name) ?? '');
    switch (msg.t) {
      case 'hello': {
        // the client lists ships it believes are away; anything we do not know about comes home
        const ids = Array.isArray(msg.shipIds) ? msg.shipIds.map(String) : [];
        const known = new Set<string>([
          ...(run?.ships.filter((x) => x.owner === name).map((x) => x.id) ?? []),
          ...(this.queue.find((e) => e.name === name)?.offers.map((o) => o.id) ?? []),
        ]);
        const orphans = ids.filter((id) => !known.has(id));
        if (orphans.length) this.sendTo(ws, { t: 'orphans', shipIds: orphans });
        if (run) this.sendTo(ws, { t: 'start', runId: run.id, tier: run.tier, snap: snapshot(run) });
        else if (this.queue.some((e) => e.name === name)) this.sendQueueStatus();
        return;
      }
      case 'queue': {
        if (run || this.queue.some((e) => e.name === name)) return this.sendTo(ws, { t: 'error', msg: 'Du bist schon in einer Koop-Anomalie oder Warteschlange.' });
        const tier = Math.floor(Number(msg.tier));
        const offers = (Array.isArray(msg.ships) ? msg.ships : []).slice(0, CONFIG.expedition.maxShips) as ShipOffer[];
        if (!(tier >= 1 && tier <= 50) || offers.length === 0) return this.sendTo(ws, { t: 'error', msg: 'Ungültige Anfrage.' });
        this.queue.push({ name, tier, offers, since: this.o.now() });
        this.sendQueueStatus();
        this.matchmake();
        return;
      }
      case 'cancel': {
        const entry = this.queue.find((e) => e.name === name);
        if (!entry) return;
        this.queue = this.queue.filter((e) => e !== entry);
        this.tell(name, { t: 'cancelled', shipIds: entry.offers.map((o) => o.id) });
        this.sendQueueStatus();
        return;
      }
      case 'move':
        if (run) moveShip(run, name, String(msg.id), { x: Number(msg.x), y: Number(msg.y) });
        return;
      case 'jump':
        if (run) jumpShip(run, name, String(msg.id));
        return;
      case 'ability':
        if (run) useAbility(run, name, String(msg.id));
        return;
    }
  }

  // ---- matchmaking ------------------------------------------------------------------

  private sendQueueStatus() {
    const now = this.o.now();
    for (const e of this.queue) {
      const same = this.queue.filter((x) => x.tier === e.tier);
      const oldest = Math.min(...same.map((x) => x.since));
      const wait = same.length >= 2 ? this.o.groupDelayMs : this.o.matchWaitMs;
      this.tell(e.name, { t: 'queued', tier: e.tier, waiting: same.length, startsIn: Math.max(0, Math.ceil((oldest + wait - now) / 1000)) }, false);
    }
  }

  private matchmake() {
    const now = this.o.now();
    const tiers = [...new Set(this.queue.map((e) => e.tier))];
    for (const tier of tiers) {
      const group = this.queue.filter((e) => e.tier === tier).sort((a, b) => a.since - b.since);
      const oldest = group[0].since;
      const ready =
        group.length >= MAX_PLAYERS ||
        (group.length >= 2 && now - oldest >= this.o.groupDelayMs) ||
        now - oldest >= this.o.matchWaitMs;
      if (!ready) continue;
      const members = group.slice(0, MAX_PLAYERS);
      this.queue = this.queue.filter((e) => !members.includes(e));
      const run = createRun(randomBytes(6).toString('hex'), tier, randomBytes(4).readUInt32LE(), members.length);
      for (const m of members) joinRun(run, m.name, m.offers);
      this.runs.set(run.id, run);
      for (const m of members) {
        this.playerRun.set(m.name, run.id);
        this.tell(m.name, { t: 'start', runId: run.id, tier, snap: snapshot(run) });
      }
    }
  }

  // ---- simulation -------------------------------------------------------------------

  /** Advance everything by dt seconds (called by the timer, or directly in tests). */
  step(dt: number) {
    this.ticks += 1;
    this.matchmake();
    if (this.ticks % 10 === 0) this.sendQueueStatus();
    for (const run of this.runs.values()) {
      tickRun(run, dt);
      for (const ev of run.events.splice(0)) {
        if (ev.t === 'returned') this.tell(ev.owner, { t: 'returned', runId: run.id, shipId: ev.shipId, shards: ev.shards, hull: ev.hull });
        if (ev.t === 'lost') this.tell(ev.owner, { t: 'lost', runId: run.id, shipId: ev.shipId, reason: ev.reason });
      }
      const members = run.players.map((p) => p.name);
      if (run.ended) {
        for (const name of members) {
          this.tell(name, { t: 'end', runId: run.id, tier: run.tier, players: run.players });
          this.playerRun.delete(name);
        }
        this.runs.delete(run.id);
      } else if (this.ticks % this.o.snapEvery === 0) {
        const snap = JSON.stringify({ t: 'snap', snap: snapshot(run) });
        for (const name of members) for (const ws of this.sockets.get(name) ?? []) if (ws.readyState === 1) ws.send(snap);
      }
    }
  }

  /** For tests and monitoring. */
  stats() {
    return { queued: this.queue.length, runs: this.runs.size };
  }
}
