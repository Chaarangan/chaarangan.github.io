import { Env } from './config';

// A counter per (bucket, reader) that KV expires for us, so nothing has to be
// swept. Turnstile stops the bots that cannot solve it; this stops the ones
// that can, and the human posting forty times (D9).
//
// The TTL restarts on every write, which makes the window sliding rather than
// fixed: someone who keeps hammering stays blocked until they stop for a whole
// window. For abuse control that is the behaviour we want.
export async function allow(
  env: Env, bucket: string, key: string, limit: number, windowSec: number
): Promise<boolean> {
  const k = `rl:${bucket}:${key}`;
  const current = parseInt((await env.RATE.get(k)) || '0', 10);
  if (current >= limit) return false;
  // KV enforces a 60s floor on expirationTtl; a shorter window would silently
  // become 60s, so clamp here rather than let callers believe a lie.
  await env.RATE.put(k, String(current + 1), { expirationTtl: Math.max(60, windowSec) });
  return true;
}
