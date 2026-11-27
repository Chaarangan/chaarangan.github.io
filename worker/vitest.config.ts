import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      // Bindings come from wrangler.toml so the tests exercise the same shape
      // as production. Secrets are injected here because .dev.vars is not
      // committed and these values are fake anyway.
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          ENVIRONMENT: 'dev',
          TURNSTILE_SECRET: 'test-turnstile-secret',
          RESEND_API_KEY: 'test-resend-key',
          ALERT_EMAIL: 'alerts@example.com',
          ADMIN_TOKEN: 'test-admin-token',
          IP_HASH_SECRET: 'test-ip-secret',
        },
      },
    }),
  ],
});
