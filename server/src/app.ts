// HTTP API: accounts, sessions and cloud saves. Also serves the built game when STATIC_DIR is set.
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { FailLimiter, hashPassword, hashToken, newToken, validName, validPassword, verifyPassword } from './auth';
import { CoopHub, type HubOptions } from './coop';
import { openDb } from './db';

export interface AppOptions {
  dbPath: string;
  staticDir?: string;
  logger?: boolean;
  coop?: HubOptions & { autoStart?: boolean };
}

const SESSION_DAYS = 90;
const MAX_SAVE_BYTES = 1_500_000;

export function buildApp(opts: AppOptions) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024, trustProxy: true });
  const db = openDb(opts.dbPath);
  const limiter = new FailLimiter();

  const q = {
    userByName: db.prepare('SELECT id, name, pass_hash FROM users WHERE name = ?'),
    insertUser: db.prepare('INSERT INTO users (name, pass_hash, created_at) VALUES (?, ?, ?)'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)'),
    session: db.prepare(
      'SELECT s.user_id AS id, u.name AS name, s.last_seen AS lastSeen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
    ),
    touchSession: db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    expireSessions: db.prepare('DELETE FROM sessions WHERE last_seen < ?'),
    getSave: db.prepare('SELECT data, rev, saved_at AS savedAt FROM saves WHERE user_id = ?'),
    upsertSave: db.prepare(`
      INSERT INTO saves (user_id, data, rev, saved_at, updated_at) VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, rev = saves.rev + 1,
        saved_at = excluded.saved_at, updated_at = excluded.updated_at`),
  };

  function startSession(userId: number) {
    const token = newToken();
    const now = Date.now();
    q.insertSession.run(hashToken(token), userId, now, now);
    return token;
  }

  /** The user behind a session token, or null when it is unknown or expired. */
  function userFromToken(token: string): { id: number; name: string } | null {
    const row = token ? (q.session.get(hashToken(token)) as { id: number; name: string; lastSeen: number } | undefined) : undefined;
    const now = Date.now();
    if (!row || now - row.lastSeen > SESSION_DAYS * 86400_000) return null;
    q.touchSession.run(now, hashToken(token));
    return { id: row.id, name: row.name };
  }

  /** The signed-in user, or null (and a 401 reply) when the token is missing or expired. */
  function auth(req: FastifyRequest, reply: FastifyReply): { id: number; name: string } | null {
    const header = req.headers.authorization ?? '';
    const user = userFromToken(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!user) reply.code(401).send({ error: 'Nicht angemeldet.' });
    return user;
  }

  // ---- co-op anomalies over WebSocket ------------------------------------------------
  const hub = new CoopHub(opts.coop);
  if (opts.coop?.autoStart !== false) hub.start();
  app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });
  app.register(async (scope) => {
    scope.get('/ws', { websocket: true }, (socket) => {
      let name: string | null = null;
      const authTimer = setTimeout(() => name || socket.close(), 10_000);
      socket.on('message', (data: Buffer) => {
        const raw = data.toString();
        if (name) return hub.handle(name, socket, raw);
        try {
          const msg = JSON.parse(raw);
          const user = msg.t === 'auth' ? userFromToken(String(msg.token ?? '')) : null;
          if (!user) {
            socket.send(JSON.stringify({ t: 'error', msg: 'Nicht angemeldet.' }));
            return socket.close();
          }
          name = user.name;
          clearTimeout(authTimer);
          socket.send(JSON.stringify({ t: 'authed', name }));
          hub.connect(name, socket);
        } catch {
          socket.close();
        }
      });
      socket.on('close', () => {
        clearTimeout(authTimer);
        if (name) hub.disconnect(name, socket);
      });
    });
  });

  app.get('/api/health', async () => ({ ok: true }));

  app.post('/api/register', async (req, reply) => {
    const { name, password } = (req.body ?? {}) as { name?: unknown; password?: unknown };
    if (!validName(name)) return reply.code(400).send({ error: 'Name: 3–20 Zeichen, nur Buchstaben, Ziffern, _ oder -.' });
    if (!validPassword(password)) return reply.code(400).send({ error: 'Passwort: mindestens 8 Zeichen.' });
    if (q.userByName.get(name)) return reply.code(409).send({ error: 'Dieser Name ist schon vergeben.' });
    const res = q.insertUser.run(name, await hashPassword(password), Date.now());
    return { token: startSession(Number(res.lastInsertRowid)), name };
  });

  app.post('/api/login', async (req, reply) => {
    const { name, password } = (req.body ?? {}) as { name?: unknown; password?: unknown };
    if (typeof name !== 'string' || typeof password !== 'string') return reply.code(400).send({ error: 'Name und Passwort angeben.' });
    const key = `${req.ip}|${name.toLowerCase()}`;
    if (limiter.blocked(key)) return reply.code(429).send({ error: 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.' });
    const user = q.userByName.get(name) as { id: number; name: string; pass_hash: string } | undefined;
    if (!user || !(await verifyPassword(password, user.pass_hash))) {
      limiter.fail(key);
      return reply.code(401).send({ error: 'Name oder Passwort falsch.' });
    }
    limiter.reset(key);
    q.expireSessions.run(Date.now() - SESSION_DAYS * 86400_000);
    return { token: startSession(user.id), name: user.name };
  });

  app.post('/api/logout', async (req, reply) => {
    const user = auth(req, reply);
    if (!user) return reply;
    q.deleteSession.run(hashToken((req.headers.authorization ?? '').slice(7)));
    return { ok: true };
  });

  app.get('/api/me', async (req, reply) => {
    const user = auth(req, reply);
    if (!user) return reply;
    return { name: user.name };
  });

  app.get('/api/save', async (req, reply) => {
    const user = auth(req, reply);
    if (!user) return reply;
    const row = q.getSave.get(user.id) as { data: string; rev: number; savedAt: number } | undefined;
    if (!row) return reply.code(404).send({ error: 'Noch kein Spielstand gespeichert.' });
    return { data: JSON.parse(row.data), rev: row.rev, savedAt: row.savedAt };
  });

  /**
   * Store a save. `rev` must be the revision the client last saw (0 if none); if another device saved
   * in between, the reply is 409 with the newer revision so the player can choose. `force` overwrites.
   */
  app.put('/api/save', async (req, reply) => {
    const user = auth(req, reply);
    if (!user) return reply;
    const { data, rev, force } = (req.body ?? {}) as { data?: unknown; rev?: unknown; force?: unknown };
    if (!data || typeof data !== 'object' || Array.isArray(data)) return reply.code(400).send({ error: 'Spielstand fehlt.' });
    const json = JSON.stringify(data);
    if (json.length > MAX_SAVE_BYTES) return reply.code(413).send({ error: 'Spielstand zu groß.' });
    const current = q.getSave.get(user.id) as { rev: number; savedAt: number } | undefined;
    if (!force && (current?.rev ?? 0) !== Number(rev)) {
      return reply.code(409).send({ error: 'Auf einem anderen Gerät wurde inzwischen gespeichert.', rev: current?.rev ?? 0, savedAt: current?.savedAt ?? 0 });
    }
    const savedAt = Number((data as { savedAt?: unknown }).savedAt) || Date.now();
    q.upsertSave.run(user.id, json, savedAt, Date.now());
    const after = q.getSave.get(user.id) as { rev: number };
    return { rev: after.rev, savedAt };
  });

  if (opts.staticDir && existsSync(opts.staticDir)) {
    app.register(fastifyStatic, { root: opts.staticDir });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Nicht gefunden.' }) : reply.sendFile('index.html'),
    );
  }

  app.addHook('onClose', async () => {
    hub.stop();
    db.close();
  });
  return Object.assign(app, { hub });
}
