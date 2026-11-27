import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { resetStorage, req } from './helpers';

beforeEach(resetStorage);

async function seed(id: string, name = 'Ada', slug = 'post-a') {
  await env.DB.prepare(
    `INSERT INTO comments (id, slug, name, email, body, created_at, ip_hash, hidden)
     VALUES (?, ?, ?, 'ada@example.com', 'Hello', ?, 'hash', 0)`
  ).bind(id, slug, name, Date.now()).run();
}

describe('admin', () => {
  it('refuses the page without a token', async () => {
    expect((await SELF.fetch(req('/admin'))).status).toBe(401);
  });

  it('refuses the page with the wrong token', async () => {
    expect((await SELF.fetch(req('/admin?token=nope'))).status).toBe(401);
  });

  it('refuses a token of the right length but wrong content', async () => {
    const wrong = 'x'.repeat('test-admin-token'.length);
    expect((await SELF.fetch(req(`/admin?token=${wrong}`))).status).toBe(401);
  });

  it('lists comments for the right token', async () => {
    await seed('c1');
    const res = await SELF.fetch(req('/admin?token=test-admin-token'));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Ada');
    expect(html).toContain('c1');
  });

  it('escapes comment content in the admin html', async () => {
    await seed('c2', '<img src=x onerror=alert(1)>');
    const html = await (await SELF.fetch(req('/admin?token=test-admin-token'))).text();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('refuses a delete without the token', async () => {
    await seed('c3');
    expect((await SELF.fetch(req('/comments/c3', { method: 'DELETE' }))).status).toBe(401);
  });

  it('hides a comment on delete', async () => {
    await seed('c4');
    const res = await SELF.fetch(req('/comments/c4', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-admin-token' },
    }));
    expect(res.status).toBe(200);
    const thread = await (await SELF.fetch(req('/thread?slug=post-a'))).json() as any;
    expect(thread.comments).toHaveLength(0);
  });

  it('still shows a removed comment in the admin list', async () => {
    await seed('c5');
    await SELF.fetch(req('/comments/c5', {
      method: 'DELETE', headers: { Authorization: 'Bearer test-admin-token' },
    }));
    const html = await (await SELF.fetch(req('/admin?token=test-admin-token'))).text();
    expect(html).toContain('removed');
  });
});
