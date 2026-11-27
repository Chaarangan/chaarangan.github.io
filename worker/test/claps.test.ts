import { describe, it, expect, beforeEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import { resetStorage, req } from './helpers';

beforeEach(resetStorage);

function clap(slug: string, count: number) {
  return SELF.fetch(req('/claps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, count }),
  }));
}

describe('POST /claps', () => {
  it('records claps and returns the running total', async () => {
    const res = await clap('post-a', 3);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 3, mine: 3 });
  });

  it('accumulates across calls from the same reader', async () => {
    await clap('post-a', 3);
    expect(await (await clap('post-a', 2)).json()).toEqual({ total: 5, mine: 5 });
  });

  it('caps one reader at 20 however many they send', async () => {
    await clap('post-a', 18);
    expect(await (await clap('post-a', 50)).json()).toEqual({ total: 20, mine: 20 });
  });

  it('caps a single oversized first request too', async () => {
    expect(await (await clap('post-a', 999)).json()).toEqual({ total: 20, mine: 20 });
  });

  it('rejects a non-positive count', async () => {
    expect((await clap('post-a', 0)).status).toBe(400);
    expect((await clap('post-a', -5)).status).toBe(400);
  });

  it('rejects a missing slug', async () => {
    const res = await SELF.fetch(req('/claps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1 }),
    }));
    expect(res.status).toBe(400);
  });

  it('keeps separate totals per slug', async () => {
    await clap('post-a', 4);
    expect(await (await clap('post-b', 1)).json()).toEqual({ total: 1, mine: 1 });
  });

  it('shows the total on the thread endpoint', async () => {
    await clap('post-a', 6);
    const thread = await (await SELF.fetch(req('/thread?slug=post-a'))).json() as any;
    expect(thread.claps).toEqual({ total: 6, mine: 6 });
  });
});
