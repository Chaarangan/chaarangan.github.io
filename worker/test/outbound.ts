import { vi } from 'vitest';

// Both outbound calls the Worker makes -- Turnstile siteverify and Resend --
// are stubbed at fetch, which is the only seam they share. Anything else
// reaching the network from a test is a bug, so it throws loudly rather than
// silently succeeding.
export function stubOutbound(turnstileOk: boolean) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('challenges.cloudflare.com')) {
      return new Response(JSON.stringify({ success: turnstileOk }), { status: 200 });
    }
    if (url.includes('api.resend.com')) {
      return new Response('{}', { status: 200 });
    }
    throw new Error(`unexpected outbound fetch to ${url}`);
  }) as typeof fetch);
}
