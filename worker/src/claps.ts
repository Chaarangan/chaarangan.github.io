import { Env, LIMITS } from './config';
import { readerHash } from './hash';
import { allow } from './ratelimit';

export interface HandlerResult {
  status: number;
  body: unknown;
}

export async function postClaps(env: Env, request: Request): Promise<HandlerResult> {
  let payload: { slug?: unknown; count?: unknown };
  try {
    payload = await request.json();
  } catch {
    return { status: 400, body: { error: 'invalid json' } };
  }

  const slug = typeof payload.slug === 'string' ? payload.slug.trim() : '';
  const count = typeof payload.count === 'number' ? Math.floor(payload.count) : 0;
  if (!slug) return { status: 400, body: { error: 'slug required' } };
  if (count < 1) return { status: 400, body: { error: 'count must be positive' } };

  const ipHash = await readerHash(request, env);
  // Deliberately generous: the cap is 20 per post, and a reader working through
  // several posts should never see this. It exists to stop a loop, not a reader.
  if (!(await allow(env, 'claps', ipHash, 60, 60))) {
    return { status: 429, body: { error: 'slow down' } };
  }

  const now = Date.now();
  // min() clamps inside SQLite so two overlapping requests cannot race past the
  // cap the way a read-then-write up here could (D7).
  await env.DB.prepare(
    `INSERT INTO claps (slug, ip_hash, count, updated_at) VALUES (?, ?, MIN(?, ?), ?)
     ON CONFLICT(slug, ip_hash) DO UPDATE SET
       count = MIN(count + excluded.count, ?), updated_at = excluded.updated_at`
  ).bind(slug, ipHash, count, LIMITS.clapsPerReader, now, LIMITS.clapsPerReader).run();

  const [total, mine] = await Promise.all([
    env.DB.prepare('SELECT COALESCE(SUM(count), 0) AS total FROM claps WHERE slug = ?')
      .bind(slug).first<{ total: number }>(),
    env.DB.prepare('SELECT count FROM claps WHERE slug = ? AND ip_hash = ?')
      .bind(slug, ipHash).first<{ count: number }>(),
  ]);

  return { status: 200, body: { total: total?.total ?? 0, mine: mine?.count ?? 0 } };
}
