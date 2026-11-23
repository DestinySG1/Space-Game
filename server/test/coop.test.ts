import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

let app: ReturnType<typeof buildApp>;
let base = '';

beforeEach(async () => {
  app = buildApp({ dbPath: ':memory:', coop: { groupDelayMs: 50, matchWaitMs: 400, tickMs: 20, snapEvery: 2 } });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as { port: number };
  base = `127.0.0.1:${addr.port}`;
});
afterEach(async () => {
  await app.close();
});

/** A signed-in WebSocket client that records every message. */
async function player(name: string) {
  const res = await app.inject({ method: 'POST', url: '/api/register', payload: { name, password: 'geheim123' } });
  const token = res.json().token as string;
  const ws = new WebSocket(`ws://${base}/ws`);
  const inbox: Record<string, unknown>[] = [];
  ws.addEventListener('message', (e) => inbox.push(JSON.parse(String(e.data))));
  await new Promise((r) => ws.addEventListener('open', r));
  ws.send(JSON.stringify({ t: 'auth', token }));
  const send = (m: object) => ws.send(JSON.stringify(m));
  const waitFor = async (t: string, pred: (m: Record<string, unknown>) => boolean = () => true, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = inbox.find((m) => m.t === t && pred(m));
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`${name}: no "${t}" message; got ${inbox.map((m) => m.t).join(',')}`);
  };
  await waitFor('authed');
  return { ws, inbox, send, waitFor };
}

const ship = (id: string, type: string) => ({ id, type, name: id, fit: {}, levels: {} });

describe('co-op over WebSocket', () => {
  it('rejects connections without a valid session', async () => {
    const ws = new WebSocket(`ws://${base}/ws`);
    const msgs: string[] = [];
    ws.addEventListener('message', (e) => msgs.push(String(e.data)));
    await new Promise((r) => ws.addEventListener('open', r));
    ws.send(JSON.stringify({ t: 'auth', token: 'nope' }));
    await new Promise((r) => ws.addEventListener('close', r));
    expect(msgs[0]).toContain('Nicht angemeldet');
  });

  it('matches two players into one anomaly; each steers only their own ships and banks their loot', async () => {
    const anna = await player('Anna');
    const bernd = await player('Bernd');
    anna.send({ t: 'queue', tier: 1, ships: [ship('m1', 'miner'), ship('w1', 'warden')] });
    bernd.send({ t: 'queue', tier: 1, ships: [ship('h1', 'hauler')] });
    const a = await anna.waitFor('start');
    const b = await bernd.waitFor('start');
    expect(a.runId).toBe(b.runId);
    const snap = (await anna.waitFor('snap')).snap as { ships: { id: string; owner: string }[]; players: { name: string }[] };
    expect(snap.players.map((p) => p.name).sort()).toEqual(['Anna', 'Bernd']);
    expect(snap.ships.map((s) => `${s.owner}/${s.id}`).sort()).toEqual(['Anna/m1', 'Anna/w1', 'Bernd/h1']);

    // Bernd cannot move Anna's miner; Anna flies it onto the gate and jumps home
    bernd.send({ t: 'move', id: 'm1', x: 30, y: 0 });
    anna.send({ t: 'move', id: 'm1', x: 0.3, y: 0 });
    await new Promise((r) => setTimeout(r, 1500)); // ~1.5 s of flight at 1 tick per 20 ms
    anna.send({ t: 'jump', id: 'm1' });
    const ret = await anna.waitFor('returned', (m) => m.shipId === 'm1');
    expect(ret.shards).toBe(0);
    expect(bernd.inbox.some((m) => m.t === 'returned')).toBe(false);
    anna.ws.close();
    bernd.ws.close();
  });

  it('starts alone after the wait time, and lets a player cancel before that', async () => {
    const solo = await player('Solo');
    solo.send({ t: 'queue', tier: 2, ships: [ship('w1', 'warden')] });
    expect((await solo.waitFor('queued')).waiting).toBe(1);
    solo.send({ t: 'cancel' });
    expect((await solo.waitFor('cancelled')).shipIds).toEqual(['w1']);
    solo.send({ t: 'queue', tier: 2, ships: [ship('w1', 'warden')] });
    await solo.waitFor('start');
    solo.ws.close();
  });

  it('tells a returning client which ships the server does not know (e.g. after a restart)', async () => {
    const p = await player('Paula');
    p.send({ t: 'hello', shipIds: ['ghost1'] });
    expect((await p.waitFor('orphans')).shipIds).toEqual(['ghost1']);
    p.ws.close();
  });
});
