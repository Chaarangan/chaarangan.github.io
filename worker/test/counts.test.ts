import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SELF } from 'cloudflare:test';
import { resetStorage, req, SITE } from './helpers';
import { stubOutbound } from './outbound';
import { MAX_SLUGS } from '../src/counts';

beforeEach(async () => { await resetStorage(); stubOutbound(true); });
afterEach(() => { vi.restoreAllMocks(); });

const TOKEN = 'test-admin-token';

function clap(slug: string, count: number) {
  return SELF.fetch(req('/claps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, count }),
  }));
}

function comment(slug: string, body: string) {
  return SELF.fetch(req('/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, name: 'Ada', body, turnstile: 'test-token' }),
  })).then((r) => r.json() as Promise<any>);
}

function pushMedium(slug: string, body: Record<string, unknown>) {
  return SELF.fetch(req('/medium', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ slug, url: 'https://charangan.medium.com/a-post-abc123', ...body }),
  }));
}

function counts(slugs: string[]) {
  return SELF.fetch(req('/counts?slugs=' + encodeURIComponent(slugs.join(','))))
    .then((r) => r.json() as Promise<any>);
}

describe('GET /counts', () => {
  it('returns claps and comment counts for several slugs at once', async () => {
    await clap('/blog/a/', 4);
    await clap('/blog/b/', 2);
    await comment('/blog/a/', 'First.');
    await comment('/blog/a/', 'Second.');

    expect(await counts(['/blog/a/', '/blog/b/'])).toEqual({
      counts: {
        '/blog/a/': { claps: 4, comments: 2, medium: null },
        '/blog/b/': { claps: 2, comments: 0, medium: null },
      },
    });
  });

  it('reports zeros for a post nobody has touched rather than omitting it', async () => {
    expect(await counts(['/blog/quiet/'])).toEqual({
      counts: { '/blog/quiet/': { claps: 0, comments: 0, medium: null } },
    });
  });

  it('answers only for the slugs asked about', async () => {
    await clap('/blog/a/', 1);
    await clap('/blog/b/', 1);
    const body = await counts(['/blog/a/']);
    expect(Object.keys(body.counts)).toEqual(['/blog/a/']);
  });

  it('leaves a removed comment out of the count', async () => {
    const created = await comment('/blog/a/', 'Spam.');
    await comment('/blog/a/', 'Real.');
    await SELF.fetch(req(`/comments/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    }));
    expect((await counts(['/blog/a/'])).counts['/blog/a/'].comments).toBe(1);
  });

  it('returns numbers only, never a comment body or an author', async () => {
    await comment('/blog/a/', 'Nice write-up.');
    const raw = await SELF.fetch(req('/counts?slugs=' + encodeURIComponent('/blog/a/')))
      .then((r) => r.text());
    expect(raw).not.toContain('Nice write-up.');
    expect(raw).not.toContain('Ada');
    expect(raw).not.toContain('ip_hash');
  });

  it('sums every reader\'s claps, not just the caller\'s', async () => {
    await clap('/blog/a/', 3);
    await SELF.fetch(new Request('https://api.test/claps', {
      method: 'POST',
      headers: { Origin: SITE, 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.9' },
      body: JSON.stringify({ slug: '/blog/a/', count: 5 }),
    }));
    expect((await counts(['/blog/a/'])).counts['/blog/a/'].claps).toBe(8);
  });

  it('deduplicates a repeated slug', async () => {
    await clap('/blog/a/', 2);
    expect(await counts(['/blog/a/', '/blog/a/'])).toEqual({
      counts: { '/blog/a/': { claps: 2, comments: 0, medium: null } },
    });
  });

  it('caps how many slugs one request can ask about', async () => {
    const many = Array.from({ length: MAX_SLUGS + 10 }, (_, i) => `/blog/p${i}/`);
    const body = await counts(many);
    expect(Object.keys(body.counts)).toHaveLength(MAX_SLUGS);
  });

  it('carries the Medium tally for a cross-posted slug', async () => {
    await clap('/blog/a/', 1);
    await pushMedium('/blog/a/', { claps: 45, responses: 1 });
    const row = (await counts(['/blog/a/'])).counts['/blog/a/'];
    expect(row.claps).toBe(1);
    expect(row.comments).toBe(0);
    expect(row.medium.claps).toBe(45);
    expect(row.medium.responses).toBe(1);
    expect(row.medium.updated_at).toBeGreaterThan(0);
  });

  it('reports null Medium for a post that was never cross-posted', async () => {
    await pushMedium('/blog/a/', { claps: 45, responses: 1 });
    const body = await counts(['/blog/a/', '/blog/b/']);
    expect(body.counts['/blog/b/'].medium).toBeNull();
  });

  it('keeps Medium out of the totals this site counts itself', async () => {
    await clap('/blog/a/', 3);
    await pushMedium('/blog/a/', { claps: 45, responses: 1 });
    const row = (await counts(['/blog/a/'])).counts['/blog/a/'];
    expect(row.claps).toBe(3);
    expect(row.comments).toBe(0);
  });

  it('passes a zero Medium response count through as null', async () => {
    await pushMedium('/blog/a/', { claps: 45 });
    const row = (await counts(['/blog/a/'])).counts['/blog/a/'];
    expect(row.medium.claps).toBe(45);
    expect(row.medium.responses).toBeNull();
  });

  it('never exposes the Medium URL, which the listing does not link', async () => {
    await pushMedium('/blog/a/', { claps: 45, responses: 1 });
    const raw = await SELF.fetch(req('/counts?slugs=' + encodeURIComponent('/blog/a/')))
      .then((r) => r.text());
    expect(raw).not.toContain('charangan.medium.com');
  });

  it('rejects a request with no slugs', async () => {
    expect((await SELF.fetch(req('/counts'))).status).toBe(400);
  });

  it('returns an empty map when the parameter holds nothing usable', async () => {
    const res = await SELF.fetch(req('/counts?slugs=' + encodeURIComponent(' , ')));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ counts: {} });
  });

  it('withholds CORS headers from an unknown origin', async () => {
    const res = await SELF.fetch(req('/counts?slugs=a', {}, 'https://evil.example'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
