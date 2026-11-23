// Cloud saves on the player's own server (see server/). Works only when the game is served from that
// server; elsewhere (e.g. as a static file) the account tab says so and the game stays local.
import { CONFIG } from '../game/config';
import { migrate, simulateOffline } from '../game/sim';
import type { GameState } from '../game/types';

const TOKEN_KEY = 'lumen-reach-token';
const REV_KEY = 'lumen-reach-rev';
const KEEPALIVE_LIMIT = 60_000; // browsers cap keepalive request bodies at 64 KB

export interface CloudView {
  available: boolean | null; // null while checking
  name: string | null;
  busy: boolean;
  msg: string;
  lastSync: number; // epoch ms
  choice: { savedAt: number; rev: number } | null; // server and this device disagree
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: stay signed out after reload */
  }
}
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export class Cloud {
  view: CloudView = { available: null, name: null, busy: false, msg: '', lastSync: 0, choice: null };
  private token = read(TOKEN_KEY);
  private rev = Number(read(REV_KEY) ?? 0);

  constructor(
    private getState: () => GameState,
    private setState: (s: GameState, note: string) => void,
    private changed: () => void,
  ) {}

  private async api(path: string, method = 'GET', body?: unknown, keepalive = false) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), keepalive });
    let json: Record<string, unknown> = {};
    try {
      json = await res.json();
    } catch {
      /* empty body */
    }
    return { status: res.status, json };
  }

  private set(patch: Partial<CloudView>) {
    Object.assign(this.view, patch);
    this.changed();
  }

  /** Check for the server and resume a stored session. */
  async start() {
    if (!location.protocol.startsWith('http')) return this.set({ available: false });
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch('/api/health', { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(timer);
      const ok = res.ok && (await res.json()).ok === true;
      this.set({ available: ok });
    } catch {
      return this.set({ available: false });
    }
    if (!this.view.available || !this.token) return;
    const me = await this.api('/api/me');
    if (me.status !== 200) {
      this.forget();
      return;
    }
    this.set({ name: String(me.json.name) });
    await this.reconcile();
  }

  async signIn(mode: 'login' | 'register', name: string, password: string) {
    this.set({ busy: true, msg: '' });
    try {
      const r = await this.api(`/api/${mode}`, 'POST', { name, password });
      if (r.status !== 200) return this.set({ msg: String(r.json.error ?? 'Das hat nicht geklappt.') });
      this.token = String(r.json.token);
      store(TOKEN_KEY, this.token);
      this.rev = 0;
      store(REV_KEY, '0');
      this.set({ name: String(r.json.name), msg: mode === 'register' ? 'Konto erstellt.' : 'Angemeldet.' });
      await this.reconcile();
    } catch {
      this.set({ msg: 'Server nicht erreichbar.' });
    } finally {
      this.set({ busy: false });
    }
  }

  async signOut() {
    await this.push();
    try {
      await this.api('/api/logout', 'POST');
    } catch {
      /* the token is forgotten locally anyway */
    }
    this.forget();
    this.set({ msg: 'Abgemeldet. Der Spielstand bleibt auf diesem Gerät.' });
  }

  private forget() {
    this.token = null;
    store(TOKEN_KEY, null);
    store(REV_KEY, null);
    this.rev = 0;
    this.set({ name: null, choice: null, lastSync: 0 });
  }

  /** After sign-in: upload if the server has nothing new, otherwise let the player choose. */
  private async reconcile() {
    const r = await this.api('/api/save');
    if (r.status === 404) return void (await this.push());
    if (r.status !== 200) return;
    const rev = Number(r.json.rev);
    if (rev === this.rev) return void (await this.push()); // nothing changed elsewhere since our last sync
    this.set({ choice: { rev, savedAt: Number(r.json.savedAt) } });
  }

  /** Upload the current game. Returns false when another device saved in between. */
  async push(force = false, keepalive = false): Promise<boolean> {
    if (!this.token || !this.view.available || (this.view.choice && !force)) return false;
    const s = this.getState();
    s.savedAt = Date.now();
    const body = { data: s, rev: this.rev, force };
    if (keepalive && JSON.stringify(body).length > KEEPALIVE_LIMIT) keepalive = false;
    try {
      const r = await this.api('/api/save', 'PUT', body, keepalive);
      if (r.status === 409) {
        this.set({ choice: { rev: Number(r.json.rev), savedAt: Number(r.json.savedAt) } });
        return false;
      }
      if (r.status === 401) {
        this.forget();
        return false;
      }
      if (r.status !== 200) return false;
      this.rev = Number(r.json.rev);
      store(REV_KEY, String(this.rev));
      this.set({ lastSync: Date.now(), choice: null });
      return true;
    } catch {
      return false;
    }
  }

  /** Resolve a conflict: take the server's save, or overwrite it with this device's game. */
  async choose(take: 'server' | 'local') {
    if (take === 'local') {
      await this.push(true);
      return;
    }
    this.set({ busy: true });
    try {
      const r = await this.api('/api/save');
      const s = r.status === 200 ? migrate(r.json.data) : null;
      if (!s || s.version !== CONFIG.saveVersion) {
        this.set({ msg: 'Der Server-Spielstand ist mit dieser Version nicht lesbar.' });
        return;
      }
      const offline = simulateOffline(s, (Date.now() - s.savedAt) / 1000);
      this.rev = Number(r.json.rev);
      store(REV_KEY, String(this.rev));
      this.set({ choice: null, lastSync: Date.now() });
      this.setState(s, offline > 60 ? 'Server-Spielstand geladen (mit Offline-Fortschritt).' : 'Server-Spielstand geladen.');
    } finally {
      this.set({ busy: false });
    }
  }
}
