import { Env, LIMITS } from './config';
import { readerHash } from './hash';
import { allow } from './ratelimit';
import { verifyTurnstile } from './turnstile';
import { notifyNewComment } from './notify';
import { HandlerResult } from './claps';

// Deliberately loose: this catches a typo or a bot filling the field with
// prose, nothing more. Anything stricter rejects addresses that are valid, and
// this address is never used for auth -- only so the author can reply.
const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

export async function postComment(
  env: Env, request: Request, ctx: ExecutionContext
): Promise<HandlerResult> {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return { status: 400, body: { error: 'invalid json' } };
  }

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const slug = str(payload.slug);
  const name = str(payload.name);
  const body = str(payload.body);
  const email = str(payload.email);

  if (!slug) return { status: 400, body: { error: 'slug required' } };
  if (!name) return { status: 400, body: { error: 'name required' } };
  if (!body) return { status: 400, body: { error: 'comment required' } };
  if (name.length > LIMITS.name) return { status: 400, body: { error: 'name too long' } };
  if (body.length > LIMITS.body) return { status: 400, body: { error: 'comment too long' } };
  if (email && email.length > LIMITS.email) return { status: 400, body: { error: 'email too long' } };
  if (email && !EMAIL.test(email)) return { status: 400, body: { error: 'email looks wrong' } };

  // Verified before the rate limit, so an unverified caller cannot burn the
  // budget of whoever shares their address.
  if (!(await verifyTurnstile(str(payload.turnstile), env, request))) {
    return { status: 403, body: { error: 'verification failed' } };
  }

  const ipHash = await readerHash(request, env);
  if (!(await allow(env, 'comments', ipHash, 5, 300))) {
    return { status: 429, body: { error: 'slow down' } };
  }

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  // The body is stored exactly as typed (D10). Escaping belongs at the render,
  // where textContent handles every case, rather than here where a stripping
  // pass would have to stay correct forever.
  await env.DB.prepare(
    `INSERT INTO comments (id, slug, name, email, body, created_at, ip_hash, hidden)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
  ).bind(id, slug, name, email || null, body, createdAt, ipHash).run();

  // waitUntil so the reader's request returns as soon as the comment is stored:
  // nobody should wait on an email API to see their own words appear.
  ctx.waitUntil(notifyNewComment(env, { id, slug, name, email: email || null, body }));

  return { status: 201, body: { id, name, body, created_at: createdAt } };
}
