# Medium cross-post bundles

One folder per post, generated from the rendered site. These are staging
artifacts for copy-paste, not site pages: `_medium` is in the `exclude` list in
`_config.yml`, so nothing here is published, but the bundles are committed:
`article.html` and the PNGs are the artifacts you paste and upload, so they
need to be reachable from any machine rather than only wherever `make medium`
last ran.

```
make medium POST=a-per-token-cost-of-zero-is-not-a-cost-of-zero
```

That runs `make build` first (the generator reads `_site/`, not the markdown, so
kramdown does the conversion rather than a second half-implementation of it) and
writes:

```
_medium/<slug>/
  article.html   open in a browser, select all, copy, paste into a Medium draft
  meta.txt       title, subtitle, tags, canonical URL, and both checklists
  images/        one PNG per figure, 2x, white background
  blocks/        one .txt per fenced block, for re-adding as Medium code blocks
  blocks.txt     all of them in order, with widths and section names
  figures.json   figure order and captions
```

## Why this is a manual paste

Medium retired its write API. The docs repo was archived in March 2023 and says
"The Medium API is no longer supported", no new integration tokens have been
issued since around 2025, and Medium does not allow new integrations. There is
no official CLI. If you hold a pre-2025 integration token then
`POST /v1/users/{userId}/posts` may still work, but nothing new can be
provisioned, so the workflow here assumes the browser.

## Why the figures need rasterising

Posts here draw their charts as inline `<svg>` coloured with CSS custom
properties from `assets/css/site.css`. Medium renders neither. On import the
figures vanish silently, which is the failure mode this folder exists to
prevent. The generator resolves `var(--ink)` and friends to the light-theme
hex values, renders each SVG through headless Chrome against white, and leaves
a dashed `UPLOAD IMAGE n` placeholder in `article.html` where each one goes.

If a post introduces a new custom property, `medium_bundle.py` fails loudly
rather than shipping a figure with black-on-black text. Add the value to
`COLOURS` in the script.

Rerunning `make medium` for a slug wipes and rebuilds that folder, so keep hand
edits somewhere else. Committing the regenerated bundle afterwards is the point
rather than noise: the diff shows what changed in the version you would paste.

## Why the tables need re-adding

Medium has no table support of any kind, and the `#### OUTPUT ####` ledgers are
monospace ASCII rather than tabular markup, so there is no HTML table to paste.
The only container that keeps the columns lined up is a Medium code block.
Import also tends to drop `<pre>` or reflow it into paragraphs, which collapses
the runs of spaces the alignment depends on.

So each fenced block is written out separately under `blocks/`, and re-adding
one is a select-all and a paste rather than a hunt through the markdown:

    type ``` on an empty line (or Cmd-Option-6), then paste with Cmd-Shift-V

Paste as plain text. A rich-text paste carries formatting that Medium answers by
splitting the block at every newline. Medium's code column fits roughly 85
characters before it scrolls sideways; the generator prints the widest line per
block so you know in advance which ones are tight.

## Publishing

Prefer the import tool over pasting, because it sets `rel=canonical` back to
this site and Google then keeps the ranking here instead of on Medium:

1. `medium.com/p/import`, give it the canonical URL from `meta.txt`
2. Drop the PNGs from `images/` into the gaps where the figures were, in order,
   and put the caption from `meta.txt` under each
3. Re-add the code blocks from `blocks/`, in order. Import usually loses them,
   and a table that has lost its alignment is worse than no table
4. Add the tags from `meta.txt`

Pasting `article.html` instead gives you more control over formatting but does
not set the canonical link, so set it by hand under story settings, More
settings, Advanced settings.

Publish here first, import second. The other order hands Medium the canonical.

## Showing Medium's counts on the post page

Once the Medium copy is live, push its clap and response counts so the post page
shows them beside its own:

```sh
export ADMIN_TOKEN='...'   # the one setup.sh printed, not the .dev.vars value
export API=https://chaarangan-comments.chaarangan.workers.dev

curl -X POST "$API/medium" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"slug":"/blog/your-post-slug/",
       "url":"https://charangan.medium.com/your-post-abc123",
       "claps":5,"responses":1}'
```

This first push is the one that needs the `url`. Every refresh after it goes
through the **Refresh Medium tally** Action instead: two numbers in the Actions
tab, no token on your laptop, and it reuses the URL stored here.

The full runbook, including how to check what is stored, how to remove a row,
and what each combination of fields renders, is in `worker/README.md` under
"Medium's claps and responses". It lives there rather than here so the two do
not drift.

Two things worth knowing before you reach for automation. Medium exposes no way
to read these numbers: the write API is retired, RSS carries neither, both
hydrate client-side, and `medium.com` answers a scripted request with `403` from
Cloudflare bot management. And the counts sit beside the site's own rather than
being summed, because a clap here is capped at 20 per reader and deduplicated on
a hashed IP while a clap on Medium is up to 50 per signed-in account with no such
check.

Responses are linked rather than imported for that reason plus a simpler one:
they are other people's writing, and copying them onto this domain is not ours
to do.
