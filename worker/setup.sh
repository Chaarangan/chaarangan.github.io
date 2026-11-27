#!/usr/bin/env bash
# One-time provisioning for the comments Worker.
#
# Everything here runs against your own Cloudflare account and needs your own
# login, which is why it is a script you run rather than something the build
# does. Safe to re-run: the create steps tolerate resources that already exist.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> 1/5  Cloudflare login (opens a browser; skipped if already logged in)"
npx wrangler whoami >/dev/null 2>&1 || npx wrangler login

echo
echo "==> 2/5  creating the D1 database and the KV namespace"
npx wrangler d1 create chaarangan-comments 2>&1 | tail -20 || echo "(d1 already exists, continuing)"
npx wrangler kv namespace create RATE       2>&1 | tail -20 || echo "(kv already exists, continuing)"
echo
echo "Copy the database_id and the KV id printed above into wrangler.toml,"
echo "replacing the two dummy ids there. Press enter when done."
read -r _

echo
echo "==> 3/5  applying the schema to the remote database"
npx wrangler d1 execute chaarangan-comments --remote --file=./schema.sql

echo
echo "==> 4/5  secrets"
ADMIN_TOKEN=$(openssl rand -hex 24)
IP_HASH_SECRET=$(openssl rand -hex 32)
echo
echo "    SAVE THIS -- it is the only time it is shown."
echo "    ADMIN_TOKEN = $ADMIN_TOKEN"
echo "    The admin page is https://<worker-url>/admin?token=$ADMIN_TOKEN"
echo
printf '%s' "$ADMIN_TOKEN"    | npx wrangler secret put ADMIN_TOKEN
printf '%s' "$IP_HASH_SECRET" | npx wrangler secret put IP_HASH_SECRET
echo "Paste the Turnstile SECRET key (dashboard -> Turnstile -> your widget):"
npx wrangler secret put TURNSTILE_SECRET
echo "Paste the Resend API key:"
npx wrangler secret put RESEND_API_KEY
echo "Paste the email address alerts should go to:"
npx wrangler secret put ALERT_EMAIL

echo
echo "==> 5/5  deploy"
npx wrangler deploy

echo
echo "Done. Two values go into _config.yml under comments:"
echo "  api:                the workers.dev URL printed just above"
echo "  turnstile_site_key: the Turnstile SITE key (the public one)"
