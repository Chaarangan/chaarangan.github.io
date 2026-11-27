import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { allow } from '../src/ratelimit';

describe('allow', () => {
  it('permits up to the limit then refuses', async () => {
    expect(await allow(env, 'test', 'reader-a', 3, 60)).toBe(true);
    expect(await allow(env, 'test', 'reader-a', 3, 60)).toBe(true);
    expect(await allow(env, 'test', 'reader-a', 3, 60)).toBe(true);
    expect(await allow(env, 'test', 'reader-a', 3, 60)).toBe(false);
  });

  it('counts each bucket separately', async () => {
    expect(await allow(env, 'claps', 'reader-b', 1, 60)).toBe(true);
    expect(await allow(env, 'claps', 'reader-b', 1, 60)).toBe(false);
    expect(await allow(env, 'comments', 'reader-b', 1, 60)).toBe(true);
  });

  it('counts each reader separately', async () => {
    expect(await allow(env, 'test', 'reader-c', 1, 60)).toBe(true);
    expect(await allow(env, 'test', 'reader-d', 1, 60)).toBe(true);
  });
});
