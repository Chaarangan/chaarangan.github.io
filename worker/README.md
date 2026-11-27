# chaarangan-comments

The Cloudflare Worker behind the claps and comments on
[chaarangan.github.io/blog](https://chaarangan.github.io/blog/). Anyone can
comment or clap with no account; Turnstile and per-IP rate limits are what
stand in for a login.

It replaces giscus, which required readers to sign in with GitHub.

## Layout

| File | Responsibility |
|------|----------------|
| `src/index.ts` | Routing and preflight |
| `src/config.ts` | `Env`, the limits, CORS |
| `src/thread.ts` | `GET /thread` — the one public read for a post |
| `src/counts.ts` | `GET /counts` — claps and comment counts for a page of posts |
| `src/claps.ts` | `POST /claps` |
| `src/comments.ts` | `POST /comments` — validation, Turnstile, storage |
| `src/turnstile.ts` | siteverify |
| `src/notify.ts` | the Resend alert |
| `src/admin.ts` | `GET /admin`, `DELETE /comments/:id` |
| `src/medium.ts` | `POST /medium`, `DELETE /medium/:slug` — the cross-post tally |
| `src/hash.ts` | HMAC of the caller's IP; raw addresses are never stored |
| `src/ratelimit.ts` | KV counters |

## First-time setup

    ./setup.sh

You need a Turnstile widget (dashboard → Turnstile → hostname
`chaarangan.github.io`) and a Resend API key before running it.

## Day to day

    npm test                     # 71 tests, no network, no account needed
    npx tsc --noEmit             # typecheck
    npx wrangler dev --local     # run against a local D1 and KV
    npx wrangler deploy          # ship

Local runs read `.dev.vars`, which is gitignored. It uses Cloudflare's
documented always-passes Turnstile test pair, so the form is testable without a
real widget:

    ENVIRONMENT=dev
    TURNSTILE_SECRET=1x0000000000000000000000000000000AA
    RESEND_API_KEY=local-not-used
    ALERT_EMAIL=local@example.com
    ADMIN_TOKEN=local-admin-token
    IP_HASH_SECRET=local-ip-secret

The matching site key for local pages is `1x00000000000000000000AA`.

## Moderation

Comments publish immediately, so moderation is after the fact:

- **Admin page:** `https://<worker-url>/admin?token=<ADMIN_TOKEN>` — every
  comment, newest first, with a Remove button. Removal is a soft delete, so a
  removed comment stays visible here but disappears from the post.
- **Email:** every new comment triggers one, via Resend.

Rotate the admin token with `npx wrangler secret put ADMIN_TOKEN`.

Rotating `IP_HASH_SECRET` is not free: it invalidates every existing clap
dedupe, so readers who already clapped can clap again up to the cap.

## Backups

    npx wrangler d1 export chaarangan-comments --remote --output=backup.sql

Worth doing before any schema change. The data is yours; nothing here holds it
hostage.

## Counts on the listing pages

`/blog/` and every tag page show this site's own claps and comment count beside
each row, before the tags, and Medium's tally after them where a post was
cross-posted. They are read once per page:

    curl -s "$API/counts?slugs=%2Fblog%2Fone%2F,%2Fblog%2Ftwo%2F" \
      -H "Origin: https://chaarangan.github.io" | python3 -m json.tool

    {"counts": {
       "/blog/one/": {"claps": 18, "comments": 2,
                      "medium": {"claps": 45, "responses": 1,
                                 "updated_at": 1788976237161}},
       "/blog/two/": {"claps": 0, "comments": 0, "medium": null}}}

Every slug asked about comes back, zeros included, so the page never has to tell
"no claps yet" apart from "slug you did not ask about". `medium` is `null` for a
post that was never cross-posted, matching how `/thread` reports it. Fifty slugs
per request is the ceiling; a page of posts is ten.

Medium's numbers stay in their own object and are never folded into the two
above, for the reason under "Medium's claps and responses" below: they are not
the same unit. The listing labels them, so 45 claps earned on Medium cannot be
read as 45 earned here, and renders them as text — the response carries no `url`
because nothing on the listing links out.

Not a loop over `/thread`. That endpoint is built for one post and returns every
comment body in full, so a ten-row listing would be ten round trips carrying ten
threads across to render two integers each. This is two aggregate queries however
many rows there are.

Nothing on this path reads the caller's address. There is no `mine` in the
response, so no reader hash is computed and the listing cannot attribute a clap
to anyone — which is also why the rows show counts rather than a clap button.
Clapping stays on the post page, where the cap and the dedupe live.

A zero is not rendered, and a post with nothing yet shows neither glyph. `0
comments` beside a new post is noise, and this matches how the Medium tally
already treats a zero.

## Medium's claps and responses

A post cross-posted to Medium shows Medium's numbers beside the site's own, on
the right of the clap row. They are pushed here by hand, so refreshing one is a
single request.

### Refreshing a count

Two ways in. The Action is the one to reach for; the curl below is what it runs
and what to fall back on when something needs inspecting.

**From the Actions tab.** Run **Refresh Medium tally**
(`.github/workflows/refresh-medium-tally.yml`), type the two numbers off the
Medium page, and leave `slug` at its default for the post it names. It needs
`COMMENTS_ADMIN_TOKEN` as a repository secret, holding the same token as below.

The `url` input stays empty for a refresh: the workflow reads the URL already
stored for that slug and sends it back up, because the row is replaced wholesale
rather than patched. Only the *first* push for a post needs it typed, and the run
fails saying so rather than storing a row with no link. The run reads the tally
back through the public endpoint afterwards and fails if the stored claps do not
match what was asked, so a green run means a reader's browser now sees the new
number — not merely that the request was accepted.

**By hand.** Set the token once per shell. It is the `ADMIN_TOKEN` that
`setup.sh` printed at install time, the same one in the query string of your
`/admin?token=...` URL, and it is *not* the placeholder in `.dev.vars`:

    export ADMIN_TOKEN='...'
    export API=https://chaarangan-comments.chaarangan.workers.dev

Then push the current numbers. Read them off the Medium page and send them:

    curl -X POST "$API/medium" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -d '{"slug":"/blog/a-per-token-cost-of-zero-is-not-a-cost-of-zero/",
           "url":"https://charangan.medium.com/a-per-token-cost-of-zero-is-not-a-cost-of-zero-charangan-vasantharajan-c24a447137f2",
           "claps":5,"responses":1}'

Sending it again overwrites, so refreshing is the same command with new numbers.
There is nothing to clear first and no way to double-count. `url` has to be
resent each time; the row is replaced wholesale rather than patched.

`slug` is the post's URL path with both slashes, exactly what
`data-comments-slug` carries in the rendered page.

### Checking what is stored

    curl -s "$API/thread?slug=%2Fblog%2Fa-per-token-cost-of-zero-is-not-a-cost-of-zero%2F" \
      -H "Origin: https://chaarangan.github.io" | python3 -m json.tool

The slug is URL-encoded here because it is a query parameter: `/` becomes `%2F`.
Look for the `medium` key. `null` means no row, and the page renders nothing.

### Removing it

    curl -X DELETE "$API/medium/%2Fblog%2Fa-per-token-cost-of-zero-is-not-a-cost-of-zero%2F" \
      -H "Authorization: Bearer $ADMIN_TOKEN"

Same encoding, since the slug is in the path.

### What renders

| stored | shown |
|--------|-------|
| `claps` and `responses` | `5 claps and 1 response on Medium ->` |
| `claps` only | `5 claps on Medium ->` |
| `url` only | `Also on Medium ->` |
| no row | nothing; the element stays hidden |

`updated_at` is set server-side and becomes the tooltip ("as of Sep 6, 2026"),
so a stale number reads as a snapshot rather than as live.

### Why pushed and not fetched

Medium exposes no way to read either number. The write API is retired, RSS
carries neither, both hydrate client-side, and `medium.com` answers a scripted
request with `403 Attention Required` from Cloudflare bot management. Fetching
on page view would also put the post page behind Medium being reachable, and
break silently whenever Medium redesigns.

### Notes on the shape

- `url` must be `https`. It ends up in an `href`, so the scheme is checked here
  and again in `comments.js` rather than trusted in one place. The host is
  deliberately unconstrained, since publications run on their own domains.
- A count of `0` or absent both store `null`, so the page can render
  "5 claps on Medium" without an "and 0 responses" tail.
- The numbers are never added to the site's own claps. A clap here is capped at
  20 per reader and deduplicated on a hashed IP; a clap on Medium is up to 50
  per signed-in account with no such check, so one total would blend two scales
  and measure nothing.

### If a schema change is ever needed here

`wrangler d1 execute` defaults to **local**. A remote change needs `--remote`,
and must be applied before deploying code that reads the new column, or
`/thread` errors for every reader in between. Merging a PR does not deploy this
Worker; `npx wrangler deploy` does.
