// Password hashing (scrypt) and session tokens. Only hashes are stored, never passwords or raw tokens.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEYLEN, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Account names: 3–20 letters, digits, _ or - (umlauts allowed). */
export const validName = (name: unknown): name is string =>
  typeof name === 'string' && /^[A-Za-z0-9_\-ÄÖÜäöüß]{3,20}$/.test(name);

export const validPassword = (pw: unknown): pw is string => typeof pw === 'string' && pw.length >= 8 && pw.length <= 200;

/** Simple in-memory limiter for failed logins: max `limit` failures per key per window. */
export class FailLimiter {
  private hits = new Map<string, number[]>();
  constructor(private limit = 10, private windowMs = 15 * 60 * 1000) {}
  blocked(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.hits.set(key, list);
    return list.length >= this.limit;
  }
  fail(key: string, now = Date.now()): void {
    this.hits.set(key, [...(this.hits.get(key) ?? []), now]);
  }
  reset(key: string): void {
    this.hits.delete(key);
  }
}
