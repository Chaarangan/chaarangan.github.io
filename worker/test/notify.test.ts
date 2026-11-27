import { describe, it, expect, vi, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { notifyNewComment } from '../src/notify';

afterEach(() => { vi.restoreAllMocks(); });

const comment = { id: 'abc', slug: 'post-a', name: 'Ada', email: 'ada@example.com', body: 'Hi' };

describe('notifyNewComment', () => {
  it('posts the alert to Resend', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    await notifyNewComment(env, comment);
    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe('https://api.resend.com/emails');
    const sent = JSON.parse(init.body as string);
    expect(sent.to).toEqual([env.ALERT_EMAIL]);
    expect(sent.text).toContain('Ada');
    expect(sent.text).toContain('post-a');
  });

  it('swallows a Resend failure so the comment still succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('resend down'));
    await expect(notifyNewComment(env, comment)).resolves.toBeUndefined();
  });
});
