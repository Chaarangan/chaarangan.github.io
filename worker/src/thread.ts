import { Env } from './config';
import { readerHash } from './hash';
import { MediumTally } from './medium';

export interface PublicComment {
  id: string;
  name: string;
  body: string;
  created_at: number;
}

export async function getThread(env: Env, slug: string, request: Request) {
  const ipHash = await readerHash(request, env);

  // One round trip per post (D14), and one place that decides what is public.
  // The SELECT names its columns rather than using *, so adding a column to the
  // table can never quietly start leaking it.
  const [total, mine, comments, medium] = await Promise.all([
    env.DB.prepare('SELECT COALESCE(SUM(count), 0) AS total FROM claps WHERE slug = ?')
      .bind(slug).first<{ total: number }>(),
    env.DB.prepare('SELECT count FROM claps WHERE slug = ? AND ip_hash = ?')
      .bind(slug, ipHash).first<{ count: number }>(),
    env.DB.prepare(
      'SELECT id, name, body, created_at FROM comments WHERE slug = ? AND hidden = 0 ORDER BY created_at ASC'
    ).bind(slug).all<PublicComment>(),
    env.DB.prepare(
      'SELECT url, claps, responses, updated_at FROM medium WHERE slug = ?'
    ).bind(slug).first<MediumTally>(),
  ]);

  return {
    claps: { total: total?.total ?? 0, mine: mine?.count ?? 0 },
    comments: comments.results ?? [],
    // null rather than omitted, so the client has one thing to test.
    medium: medium ?? null,
  };
}
