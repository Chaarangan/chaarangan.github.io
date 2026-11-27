import { env } from 'cloudflare:test';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS comments (
     id TEXT PRIMARY KEY, slug TEXT NOT NULL, name TEXT NOT NULL, email TEXT,
     body TEXT NOT NULL, created_at INTEGER NOT NULL, ip_hash TEXT NOT NULL,
     hidden INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_slug ON comments(slug, created_at)`,
  `CREATE TABLE IF NOT EXISTS claps (
     slug TEXT NOT NULL, ip_hash TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL, PRIMARY KEY (slug, ip_hash))`,
  `CREATE TABLE IF NOT EXISTS medium (
     slug TEXT PRIMARY KEY, url TEXT NOT NULL, claps INTEGER, responses INTEGER,
     updated_at INTEGER NOT NULL)`,
];

// D1's exec() splits on newlines, which mangles multi-line DDL. Running each
// statement through prepare() lets the schema stay readable here. The KV reset
// is needed because @cloudflare/vitest-plugin keeps storage across tests in a file.
export async function resetStorage() {
  for (const stmt of SCHEMA) await env.DB.prepare(stmt).run();
  await env.DB.prepare('DELETE FROM comments').run();
  await env.DB.prepare('DELETE FROM claps').run();
  await env.DB.prepare('DELETE FROM medium').run();
  const { keys } = await env.RATE.list();
  await Promise.all(keys.map((k) => env.RATE.delete(k.name)));
}

export const SITE = 'https://chaarangan.github.io';

export function req(path: string, init: RequestInit = {}, origin: string = SITE): Request {
  return new Request(`https://api.test${path}`, {
    ...init,
    headers: { Origin: origin, 'CF-Connecting-IP': '203.0.113.7', ...(init.headers || {}) },
  } as RequestInit);
}
