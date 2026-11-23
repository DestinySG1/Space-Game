import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ dbPath: ':memory:' });
});
afterEach(async () => {
  await app.close();
});

async function register(name = 'Robin', password = 'geheim123') {
  const res = await app.inject({ method: 'POST', url: '/api/register', payload: { name, password } });
  return { res, token: res.json().token as string };
}
const authed = (token: string) => ({ authorization: `Bearer ${token}` });

describe('accounts', () => {
  it('registers, logs in and refuses duplicates, weak passwords and bad names', async () => {
    const { res, token } = await register();
    expect(res.statusCode).toBe(200);
    expect(token).toBeTruthy();
    expect((await register('robin')).res.statusCode).toBe(409); // names are case-insensitive
    expect((await register('Neu', 'kurz')).res.statusCode).toBe(400);
    expect((await register('a b', 'geheim123')).res.statusCode).toBe(400);
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'ROBIN', password: 'geheim123' } });
    expect(login.statusCode).toBe(200);
    expect(login.json().name).toBe('Robin');
    const me = await app.inject({ url: '/api/me', headers: authed(login.json().token) });
    expect(me.json()).toEqual({ name: 'Robin' });
  });

  it('rejects wrong passwords and blocks after repeated failures', async () => {
    await register();
    for (let i = 0; i < 10; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Robin', password: 'falsch!!' } });
      expect(r.statusCode).toBe(401);
    }
    const blocked = await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Robin', password: 'geheim123' } });
    expect(blocked.statusCode).toBe(429);
  });

  it('logout ends the session', async () => {
    const { token } = await register();
    expect((await app.inject({ method: 'POST', url: '/api/logout', headers: authed(token) })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/me', headers: authed(token) })).statusCode).toBe(401);
  });
});

describe('cloud saves', () => {
  it('stores and returns a save, with revisions', async () => {
    const { token } = await register();
    expect((await app.inject({ url: '/api/save', headers: authed(token) })).statusCode).toBe(404);
    const put = await app.inject({ method: 'PUT', url: '/api/save', headers: authed(token), payload: { data: { credits: 5, savedAt: 1000 }, rev: 0 } });
    expect(put.json()).toEqual({ rev: 1, savedAt: 1000 });
    const get = await app.inject({ url: '/api/save', headers: authed(token) });
    expect(get.json()).toEqual({ data: { credits: 5, savedAt: 1000 }, rev: 1, savedAt: 1000 });
  });

  it('detects a save from another device and allows a forced overwrite', async () => {
    const { token } = await register();
    await app.inject({ method: 'PUT', url: '/api/save', headers: authed(token), payload: { data: { a: 1 }, rev: 0 } });
    await app.inject({ method: 'PUT', url: '/api/save', headers: authed(token), payload: { data: { a: 2 }, rev: 1 } });
    const stale = await app.inject({ method: 'PUT', url: '/api/save', headers: authed(token), payload: { data: { a: 3 }, rev: 1 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().rev).toBe(2);
    const forced = await app.inject({ method: 'PUT', url: '/api/save', headers: authed(token), payload: { data: { a: 3 }, rev: 1, force: true } });
    expect(forced.json().rev).toBe(3);
  });

  it('keeps players apart and requires a session', async () => {
    const a = await register('Anna');
    const b = await register('Bernd');
    await app.inject({ method: 'PUT', url: '/api/save', headers: authed(a.token), payload: { data: { who: 'anna' }, rev: 0 } });
    expect((await app.inject({ url: '/api/save', headers: authed(b.token) })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/save' })).statusCode).toBe(401);
  });
});
