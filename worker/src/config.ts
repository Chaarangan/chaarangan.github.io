export interface Env {
  DB: D1Database;
  RATE: KVNamespace;
  TURNSTILE_SECRET: string;
  RESEND_API_KEY: string;
  ALERT_EMAIL: string;
  ADMIN_TOKEN: string;
  IP_HASH_SECRET: string;
  ENVIRONMENT: string;
}

// Enforced here because the form is the only thing constraining a browser, and
// nothing at all constrains a script.
export const LIMITS = {
  name: 60,
  email: 120,
  body: 2000,
  clapsPerReader: 20,
};

const SITE_ORIGIN = 'https://chaarangan.github.io';
const DEV_ORIGIN = 'http://localhost:4012';

// The API is public, but only this site should be able to drive it from a
// browser (D15). Echoing the caller's origin rather than answering "*" is what
// keeps the allow-list meaningful: an origin we do not know gets no CORS header
// at all, and the browser refuses to hand the response to the page.
export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ENVIRONMENT === 'dev' ? [SITE_ORIGIN, DEV_ORIGIN] : [SITE_ORIGIN];
  if (!allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

export function json(data: unknown, status: number, request: Request, env: Env): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
  });
}
