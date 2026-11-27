import { Env } from './config';
import { HandlerResult } from './claps';

// Length-independent comparison. This is a bearer secret, and a plain ===
// returns early on the first wrong byte, which leaks the prefix to anyone
// willing to measure.
export function tokenOk(supplied: string, expected: string): boolean {
  if (supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < supplied.length; i++) {
    diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export function suppliedToken(request: Request): string {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return new URL(request.url).searchParams.get('token') || '';
}

// The admin page is the one place a comment is rendered as HTML rather than set
// with textContent, so it escapes here. A spam comment carrying markup must not
// execute in the face of the person cleaning it up.
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
}

interface AdminRow {
  id: string; slug: string; name: string; email: string | null;
  body: string; created_at: number; hidden: number;
}

export async function adminPage(env: Env, request: Request): Promise<Response> {
  const token = suppliedToken(request);
  if (!tokenOk(token, env.ADMIN_TOKEN)) {
    return new Response('unauthorized', { status: 401 });
  }

  const { results } = await env.DB.prepare(
    `SELECT id, slug, name, email, body, created_at, hidden FROM comments
     ORDER BY created_at DESC LIMIT 200`
  ).all<AdminRow>();

  const rows = (results ?? []).map((c) => `
    <tr class="${c.hidden ? 'gone' : ''}">
      <td>${esc(new Date(c.created_at).toISOString().slice(0, 16).replace('T', ' '))}</td>
      <td>${esc(c.slug)}</td>
      <td>${esc(c.name)}<br><small>${esc(c.email || 'no email')}</small></td>
      <td>${esc(c.body)}</td>
      <td><code>${esc(c.id)}</code></td>
      <td>${c.hidden ? 'removed' : `<button data-id="${esc(c.id)}">Remove</button>`}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Comments admin</title><meta name="robots" content="noindex">
<style>body{font:14px system-ui;margin:24px;max-width:1100px}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}
.gone{opacity:.45}button{cursor:pointer}</style></head><body>
<h1>Comments</h1>
<table><tr><th>When</th><th>Post</th><th>Who</th><th>Comment</th><th>Id</th><th></th></tr>
${rows}</table>
<script>
document.querySelectorAll('button[data-id]').forEach(function (b) {
  b.addEventListener('click', function () {
    fetch('/comments/' + b.getAttribute('data-id'), {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + ${JSON.stringify(token)} }
    }).then(function (r) { if (r.ok) location.reload(); else alert('Delete failed'); });
  });
});
</script></body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' },
  });
}

export async function deleteComment(env: Env, request: Request, id: string): Promise<HandlerResult> {
  if (!tokenOk(suppliedToken(request), env.ADMIN_TOKEN)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  // Soft delete: a removed comment stays visible in the admin list, which is
  // what tells you whether a repeat commenter is a person or a bot.
  await env.DB.prepare('UPDATE comments SET hidden = 1 WHERE id = ?').bind(id).run();
  return { status: 200, body: { deleted: id } };
}
