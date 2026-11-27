import { Env } from './config';
import { HandlerResult } from './claps';
import { suppliedToken, tokenOk } from './admin';

// Medium's claps and responses, stored rather than fetched.
//
// There is no read API for either number: the write API is retired, RSS omits
// both, they hydrate client-side, and medium.com sits behind Cloudflare bot
// management that answers a scripted request with 403 regardless. A Worker
// fetching Medium on page view would be blocked, would add latency to the post,
// and would break silently whenever Medium redesigns.
//
// So the numbers are pushed in by the author over an admin-authed endpoint and
// read back out with the rest of the thread. That keeps the post page free of
// any dependency on Medium being reachable, and updating a count costs one
// request instead of a commit and a rebuild.

export interface MediumTally {
  url: string;
  claps: number | null;
  responses: number | null;
  updated_at: number;
}

// The URL is rendered into an href, so the scheme is checked here rather than
// trusted to the client. javascript: and data: are the ones that matter, and
// an allow-list of exactly https is narrower than blocking what we thought of.
// Publications run on their own domains (aiadvances.org, not just medium.com),
// so the host is deliberately not constrained.
function cleanUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 500) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  return parsed.protocol === 'https:' ? parsed.toString() : null;
}

// Absent and zero are different states: a post with no responses yet should
// render "392 claps on Medium", not "392 claps and 0 responses". Absent stays
// null, and a supplied 0 is treated as absent for the same reason.
function cleanCount(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const n = Math.floor(raw);
  if (n <= 0) return null;
  return Math.min(n, 10_000_000);
}

export async function putMedium(env: Env, request: Request): Promise<HandlerResult> {
  if (!tokenOk(suppliedToken(request), env.ADMIN_TOKEN)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }

  let payload: { slug?: unknown; url?: unknown; claps?: unknown; responses?: unknown };
  try {
    payload = await request.json();
  } catch {
    return { status: 400, body: { error: 'invalid json' } };
  }

  const slug = typeof payload.slug === 'string' ? payload.slug.trim() : '';
  if (!slug) return { status: 400, body: { error: 'slug required' } };

  const url = cleanUrl(payload.url);
  if (!url) return { status: 400, body: { error: 'url required, must be https' } };

  const claps = cleanCount(payload.claps);
  const responses = cleanCount(payload.responses);
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO medium (slug, url, claps, responses, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       url = excluded.url, claps = excluded.claps,
       responses = excluded.responses, updated_at = excluded.updated_at`
  ).bind(slug, url, claps, responses, now).run();

  return { status: 200, body: { slug, url, claps, responses, updated_at: now } };
}

export async function deleteMedium(env: Env, request: Request, slug: string): Promise<HandlerResult> {
  if (!tokenOk(suppliedToken(request), env.ADMIN_TOKEN)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  if (!slug) return { status: 400, body: { error: 'slug required' } };
  await env.DB.prepare('DELETE FROM medium WHERE slug = ?').bind(slug).run();
  return { status: 200, body: { deleted: slug } };
}
