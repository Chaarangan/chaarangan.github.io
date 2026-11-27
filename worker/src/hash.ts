import { Env } from './config';

// Raw addresses never reach storage (D12). They are only ever a key for clap
// dedupe and rate limiting, and keeping them would turn this database into a
// record of who read what. HMAC rather than a bare digest, so the mapping
// cannot be rebuilt by hashing the address space.
export async function hashIp(ip: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(ip));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function readerHash(request: Request, env: Env): Promise<string> {
  // Cloudflare sets CF-Connecting-IP itself and strips any client-supplied
  // copy, so this cannot be forged to walk around a rate limit.
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  return hashIp(ip, env.IP_HASH_SECRET);
}
