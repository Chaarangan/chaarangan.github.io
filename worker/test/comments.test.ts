import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { resetDb, req } from './helpers';
import { stubOutbound } from './outbound';

beforeEach(async () => { await resetDb(); stubOutbound(true); });
afterEach(() => { vi.restoreAllMocks(); });

function post(body: Record<string, unknown>) {
  return SELF.fetch(req('/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ turnstile: 'test-token', ...body }),
  }));
}

const valid = { slug: 'post-a', name: 'Ada', body: 'Nice write-up.' };

describe('POST /comments', () => {
  it('stores a comment and returns only public fields', async () => {
    const res = await post({ ...valid, email: 'ada@example.com' });
    expect(res.status).toBe(201);
    const created = await res.json() as Record<string, unknown>;
    expect(created.name).toBe('Ada');
    expect(created.body).toBe('Nice write-up.');
    expect(created.id).toBeTruthy();
    expect(created).not.toHaveProperty('email');
    expect(created).not.toHaveProperty('ip_hash');
  });

  it('keeps the email in storage even though it never leaves', async () => {
    await post({ ...valid, email: 'ada@example.com' });
    const row = await env.DB.prepare('SELECT email FROM comments').first<{ email: string }>();
    expect(row?.email).toBe('ada@example.com');
  });

  it('never stores a raw IP', async () => {
    await post(valid);
    const row = await env.DB.prepare('SELECT ip_hash FROM comments').first<{ ip_hash: string }>();
    expect(row?.ip_hash).not.toContain('203.0.113.7');
    expect(row?.ip_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('requires a name and a body', async () => {
    expect((await post({ slug: 'post-a', body: 'x' })).status).toBe(400);
    expect((await post({ slug: 'post-a', name: 'Ada' })).status).toBe(400);
    expect((await post({ slug: 'post-a', name: '   ', body: 'x' })).status).toBe(400);
  });

  it('enforces the length caps', async () => {
    expect((await post({ ...valid, name: 'a'.repeat(61) })).status).toBe(400);
    expect((await post({ ...valid, body: 'a'.repeat(2001) })).status).toBe(400);
    expect((await post({ ...valid, email: `${'a'.repeat(115)}@e.com` })).status).toBe(400);
  });

  it('accepts a body of exactly the cap', async () => {
    expect((await post({ ...valid, body: 'a'.repeat(2000) })).status).toBe(201);
  });

  it('rejects an email that is not one', async () => {
    expect((await post({ ...valid, email: 'not-an-email' })).status).toBe(400);
  });

  it('accepts a comment with no email at all', async () => {
    expect((await post(valid)).status).toBe(201);
  });

  it('stores markup verbatim, because the render escapes rather than the store', async () => {
    await post({ ...valid, body: '<script>alert(1)</script>' });
    const row = await env.DB.prepare('SELECT body FROM comments').first<{ body: string }>();
    expect(row?.body).toBe('<script>alert(1)</script>');
  });

  it('shows the new comment in the thread', async () => {
    await post(valid);
    const thread = await (await SELF.fetch(req('/thread?slug=post-a'))).json() as any;
    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0].name).toBe('Ada');
    expect(thread.comments[0]).not.toHaveProperty('email');
  });

  it('rate limits a flood from one reader', async () => {
    for (let i = 0; i < 5; i++) expect((await post(valid)).status).toBe(201);
    expect((await post(valid)).status).toBe(429);
  });
});

describe('Turnstile', () => {
  it('refuses a comment when the token does not verify', async () => {
    vi.restoreAllMocks();
    stubOutbound(false);
    const res = await post(valid);
    expect(res.status).toBe(403);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM comments').first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('refuses a comment with no token at all', async () => {
    const res = await SELF.fetch(req('/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    }));
    expect(res.status).toBe(403);
  });
});
