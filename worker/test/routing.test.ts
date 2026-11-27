import { describe, it, expect, beforeEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import { resetDb, req, SITE } from './helpers';

beforeEach(resetDb);

describe('routing and CORS', () => {
  it('answers preflight for the site origin', async () => {
    const res = await SELF.fetch(req('/thread?slug=a', { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
  });

  it('withholds CORS headers from an unknown origin', async () => {
    const res = await SELF.fetch(req('/thread?slug=a', {}, 'https://evil.example'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('returns an empty thread for a slug nobody has touched', async () => {
    const res = await SELF.fetch(req('/thread?slug=nothing-here'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      claps: { total: 0, mine: 0 },
      comments: [],
      medium: null,
    });
  });

  it('rejects a thread request with no slug', async () => {
    expect((await SELF.fetch(req('/thread'))).status).toBe(400);
  });

  it('404s an unknown path', async () => {
    expect((await SELF.fetch(req('/nope'))).status).toBe(404);
  });
});
