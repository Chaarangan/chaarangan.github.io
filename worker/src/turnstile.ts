import { Env } from './config';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Turnstile guards comments only (D8). A captcha in front of a clap would
// destroy the gesture, and a wrong clap count is cosmetic where a spam comment
// is content. Verification happens here rather than in the page because the
// widget's own result is just a string until Cloudflare confirms it.
export async function verifyTurnstile(token: string, env: Env, request: Request): Promise<boolean> {
  if (!token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);

  try {
    const res = await fetch(SITEVERIFY, { method: 'POST', body: form });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    // Failing to reach Cloudflare is not a pass. Comments are the spam surface,
    // so when we cannot tell, the answer is no.
    return false;
  }
}
