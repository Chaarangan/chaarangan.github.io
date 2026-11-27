import { Env, corsHeaders, json } from './config';
import { getThread } from './thread';
import { getCounts } from './counts';
import { postClaps } from './claps';
import { postComment } from './comments';
import { adminPage, deleteComment } from './admin';
import { putMedium, deleteMedium } from './medium';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (request.method === 'GET' && url.pathname === '/thread') {
      const slug = url.searchParams.get('slug');
      if (!slug) return json({ error: 'slug required' }, 400, request, env);
      return json(await getThread(env, slug, request), 200, request, env);
    }

    // The listing pages: claps and comment counts for a page of posts in one
    // request. Display only -- no reader identity, no comment bodies.
    if (request.method === 'GET' && url.pathname === '/counts') {
      const slugs = url.searchParams.get('slugs');
      if (!slugs) return json({ error: 'slugs required' }, 400, request, env);
      return json({ counts: await getCounts(env, slugs) }, 200, request, env);
    }

    if (request.method === 'POST' && url.pathname === '/claps') {
      const { status, body } = await postClaps(env, request);
      return json(body, status, request, env);
    }

    if (request.method === 'POST' && url.pathname === '/comments') {
      const { status, body } = await postComment(env, request, ctx);
      return json(body, status, request, env);
    }

    // Author-only: the numbers come from a person reading their Medium page,
    // because Medium exposes no way to read them.
    if (request.method === 'POST' && url.pathname === '/medium') {
      const { status, body } = await putMedium(env, request);
      return json(body, status, request, env);
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/medium/')) {
      const slug = decodeURIComponent(url.pathname.slice('/medium/'.length));
      const { status, body } = await deleteMedium(env, request, slug);
      return json(body, status, request, env);
    }

    if (request.method === 'GET' && url.pathname === '/admin') {
      return adminPage(env, request);
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/comments/')) {
      const id = url.pathname.slice('/comments/'.length);
      const { status, body } = await deleteComment(env, request, id);
      return json(body, status, request, env);
    }

    return json({ error: 'not found' }, 404, request, env);
  },
};
