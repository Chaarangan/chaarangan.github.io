import { describe, it, expect, beforeEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import { resetDb, req } from './helpers';

beforeEach(resetDb);

const TOKEN = 'test-admin-token';
const URL_A = 'https://medium.com/@me/post-abc123';

function put(body: unknown, token: string | null = TOKEN) {
  return SELF.fetch(req('/medium', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }));
}

function thread(slug: string) {
  return SELF.fetch(req(`/thread?slug=${encodeURIComponent(slug)}`))
    .then((r) => r.json() as Promise<any>);
}

describe('POST /medium', () => {
  it('stores a tally and serves it on the thread', async () => {
    const res = await put({ slug: 'post-a', url: URL_A, claps: 392, responses: 8 });
    expect(res.status).toBe(200);

    const t = await thread('post-a');
    expect(t.medium.url).toBe(URL_A);
    expect(t.medium.claps).toBe(392);
    expect(t.medium.responses).toBe(8);
    expect(typeof t.medium.updated_at).toBe('number');
  });

  it('overwrites on a second push rather than accumulating', async () => {
    await put({ slug: 'post-a', url: URL_A, claps: 100, responses: 2 });
    await put({ slug: 'post-a', url: URL_A, claps: 392, responses: 8 });
    const t = await thread('post-a');
    expect(t.medium.claps).toBe(392);
    expect(t.medium.responses).toBe(8);
  });

  it('returns null for a post with no tally', async () => {
    expect((await thread('post-untouched')).medium).toBeNull();
  });

  it('keeps tallies separate per slug', async () => {
    await put({ slug: 'post-a', url: URL_A, claps: 392 });
    await put({ slug: 'post-b', url: 'https://medium.com/@me/other', claps: 7 });
    expect((await thread('post-a')).medium.claps).toBe(392);
    expect((await thread('post-b')).medium.claps).toBe(7);
  });

  // Absent and zero must stay distinguishable: the page renders "392 claps on
  // Medium" for the first and would render "and 0 responses" for the second.
  it('normalises an absent or zero count to null', async () => {
    await put({ slug: 'post-a', url: URL_A, claps: 392 });
    let t = await thread('post-a');
    expect(t.medium.claps).toBe(392);
    expect(t.medium.responses).toBeNull();

    await put({ slug: 'post-a', url: URL_A, claps: 392, responses: 0 });
    t = await thread('post-a');
    expect(t.medium.responses).toBeNull();
  });

  it('floors a fractional count', async () => {
    await put({ slug: 'post-a', url: URL_A, claps: 12.9 });
    expect((await thread('post-a')).medium.claps).toBe(12);
  });

  describe('auth', () => {
    it('rejects a missing token', async () => {
      expect((await put({ slug: 'post-a', url: URL_A }, null)).status).toBe(401);
    });

    it('rejects a wrong token of the same length', async () => {
      expect((await put({ slug: 'post-a', url: URL_A }, 'test-admin-tokeX')).status).toBe(401);
    });

    it('writes nothing when unauthorised', async () => {
      await put({ slug: 'post-a', url: URL_A, claps: 392 }, 'nope');
      expect((await thread('post-a')).medium).toBeNull();
    });
  });

  describe('validation', () => {
    it('rejects a missing slug', async () => {
      expect((await put({ url: URL_A })).status).toBe(400);
    });

    it('rejects a missing url', async () => {
      expect((await put({ slug: 'post-a' })).status).toBe(400);
    });

    // The url lands in an href, so anything but https is refused server-side
    // rather than left to the client to notice.
    it('rejects a non-https url', async () => {
      for (const url of [
        'javascript:alert(1)',
        'http://medium.com/@me/post',
        'data:text/html,<script>alert(1)</script>',
        'not a url',
      ]) {
        expect((await put({ slug: 'post-a', url })).status).toBe(400);
      }
      expect((await thread('post-a')).medium).toBeNull();
    });

    it('accepts a publication on its own domain', async () => {
      const url = 'https://aiadvances.org/tokenomics-for-the-agentic-harness-41dbaa822f7f';
      expect((await put({ slug: 'post-a', url })).status).toBe(200);
      expect((await thread('post-a')).medium.url).toBe(url);
    });

    it('rejects invalid json', async () => {
      const res = await SELF.fetch(req('/medium', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: '{oops',
      }));
      expect(res.status).toBe(400);
    });
  });
});

describe('DELETE /medium/:slug', () => {
  it('removes the tally', async () => {
    await put({ slug: 'post-a', url: URL_A, claps: 392 });
    const res = await SELF.fetch(req('/medium/post-a', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    }));
    expect(res.status).toBe(200);
    expect((await thread('post-a')).medium).toBeNull();
  });

  it('rejects a wrong token and leaves the row alone', async () => {
    await put({ slug: 'post-a', url: URL_A, claps: 392 });
    const res = await SELF.fetch(req('/medium/post-a', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer nope' },
    }));
    expect(res.status).toBe(401);
    expect((await thread('post-a')).medium.claps).toBe(392);
  });
});
