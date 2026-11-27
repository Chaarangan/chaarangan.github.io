import { Env } from './config';

// The numbers the listing shows beside each row, for many posts at once: this
// site's own claps and comment count, and Medium's tally where the post has one.
//
// Separate from /thread rather than a loop over it. /thread is built for one
// post and returns every comment body in full, so a page of ten rows would be
// ten round trips carrying ten threads to render two integers each. This is two
// aggregate queries whatever the row count.
//
// Nothing here reads the caller's address. There is no `mine` in the response,
// so no reader hash is computed and no clap can be attributed to anyone -- the
// listing is display only, and the clap button stays on the post page.

// Bounds the IN clause. A page of posts is ten rows; fifty is room for a tag
// page that grows without letting a hand-built query string cost anything.
export const MAX_SLUGS = 50;

// Medium's numbers stay in their own object rather than being folded into the
// two above. They are not the same unit -- a clap here is capped at 20 per
// reader and deduplicated on a hashed IP, a clap there is up to 50 per
// signed-in account with no such check -- so a client that summed them would be
// measuring nothing. Keeping them apart makes that the harder thing to do.
//
// No `url`. The listing renders these as text, not a link, so nothing here ends
// up in an href and there is no scheme to check.
export interface MediumCounts {
  claps: number | null;
  responses: number | null;
  updated_at: number;
}

export interface SlugCounts {
  claps: number;
  comments: number;
  medium: MediumCounts | null;
}

// Slugs are URL paths ("/blog/a-post/"), so a comma cannot occur inside one and
// is safe as the separator. The whole parameter arrives percent-encoded.
function parseSlugs(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const slug = part.trim();
    if (slug && slug.length <= 200) seen.add(slug);
    if (seen.size >= MAX_SLUGS) break;
  }
  return [...seen];
}

export async function getCounts(env: Env, raw: string): Promise<Record<string, SlugCounts>> {
  const slugs = parseSlugs(raw);
  if (!slugs.length) return {};

  const holes = slugs.map(() => '?').join(',');
  const [claps, comments, medium] = await Promise.all([
    env.DB.prepare(
      `SELECT slug, COALESCE(SUM(count), 0) AS n FROM claps WHERE slug IN (${holes}) GROUP BY slug`
    ).bind(...slugs).all<{ slug: string; n: number }>(),
    env.DB.prepare(
      `SELECT slug, COUNT(*) AS n FROM comments WHERE hidden = 0 AND slug IN (${holes}) GROUP BY slug`
    ).bind(...slugs).all<{ slug: string; n: number }>(),
    env.DB.prepare(
      `SELECT slug, claps, responses, updated_at FROM medium WHERE slug IN (${holes})`
    ).bind(...slugs).all<{ slug: string } & MediumCounts>(),
  ]);

  // Every slug that was asked for is present, zeros included. A post nobody has
  // clapped has no row in either table, and the client should not have to tell
  // "no engagement" apart from "slug you did not ask about".
  const out: Record<string, SlugCounts> = {};
  for (const slug of slugs) out[slug] = { claps: 0, comments: 0, medium: null };
  for (const row of claps.results ?? []) out[row.slug].claps = row.n;
  for (const row of comments.results ?? []) out[row.slug].comments = row.n;
  // null where a post was never cross-posted, matching how /thread reports it,
  // so a client has one thing to test rather than two.
  for (const row of medium.results ?? []) {
    out[row.slug].medium = {
      claps: row.claps, responses: row.responses, updated_at: row.updated_at,
    };
  }
  return out;
}
