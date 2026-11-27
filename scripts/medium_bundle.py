#!/usr/bin/env python3
"""Build a paste-ready Medium bundle from a post that is already rendered.

Medium retired its write API (the docs repo was archived in 2023 and no new
integration tokens are issued), so cross-posting is a copy-paste job. Two things
make that job annoying by hand:

  - Medium renders neither inline SVG nor CSS custom properties, so every
    diagram in a post silently vanishes on import and has to be re-uploaded as
    a raster image.
  - The theme colours live in site.css as var(--ink) and friends, which resolve
    to nothing once the SVG leaves the site.

So this reads the *rendered* post out of _site/ rather than re-implementing
kramdown, swaps each <figure><svg> for an <img> placeholder, and rasterises the
SVGs against a white background with the light-theme colours baked in.

    make build                                   # _site/ must be current
    python3 scripts/medium_bundle.py <post-slug>

Writes _medium/<slug>/ containing article.html (open it, select all, copy, paste
into a Medium draft), images/ to upload into the gaps, and meta.txt with the
title, subtitle, tags and canonical URL.
"""

import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Light theme, from assets/css/site.css :root. Medium's canvas is white, so --bg
# and --card both become white rather than the site's off-grey.
COLOURS = {
    "--bg": "#ffffff",
    "--card": "#ffffff",
    "--ink": "#182420",
    "--ink-soft": "#586761",
    "--line": "#e4e9e7",
    "--line-soft": "#eef2f0",
    "--accent": "#0e9f6e",
    "--accent-soft": "#e3f6ee",
    "--accent-ink": "#0a5c40",
}

PAD = 16          # breathing room so labels are not flush to the crop
SCALE = 2         # retina; Medium serves a 700px column


def die(msg):
    sys.exit(f"medium_bundle: {msg}")


def find_post(slug):
    for name in sorted(os.listdir(os.path.join(ROOT, "_posts"))):
        if slug in name and name.endswith(".md"):
            return os.path.join(ROOT, "_posts", name)
    die(f"no post in _posts/ matching {slug!r}")


def frontmatter(path):
    text = open(path).read()
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        die(f"{path} has no frontmatter")
    fm = {}
    for line in m.group(1).split("\n"):
        if ":" in line:
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip().strip('"')
    return fm


def rendered_body(slug):
    path = os.path.join(ROOT, "_site", "blog", slug, "index.html")
    if not os.path.exists(path):
        die(f"{path} missing. Run `make build` first.")
    html = open(path).read()
    m = re.search(r'<div class="post-body">(.*?)\n    </div>', html, re.S)
    if not m:
        die("could not find div.post-body in the rendered page")
    return m.group(1)


def slugify(text, fallback):
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (s[:48].rstrip("-") or fallback)


def extract_blocks(post_path, out_dir):
    """Split the post's fenced blocks into one file each.

    Medium has no tables. The `#### OUTPUT ####` ledgers are monospace ASCII, so
    the only container that keeps the columns lined up is a Medium code block,
    and import routinely drops <pre> or reflows it into paragraphs. Writing each
    block out separately means re-adding one is a select-all and a paste rather
    than a hunt through the markdown for the right fence.
    """
    src = open(post_path).read()
    body = re.sub(r"^---\n.*?\n---\n", "", src, flags=re.S)

    blocks, heading = [], "(intro)"
    for chunk in re.split(r"(^## .*$)", body, flags=re.M):
        if chunk.startswith("## "):
            heading = chunk[3:].strip()
            continue
        for lang, text in re.findall(r"^```(\w*)\n(.*?)^```", chunk, re.S | re.M):
            text = text.rstrip("\n")
            blocks.append({
                "n": len(blocks) + 1,
                "lang": lang or "text",
                "section": heading,
                "widest": max(len(l) for l in text.split("\n")),
                "lines": len(text.split("\n")),
                "text": text,
            })

    if not blocks:
        return []

    tbl_dir = os.path.join(out_dir, "blocks")
    os.makedirs(tbl_dir)
    for b in blocks:
        stem = slugify(b["section"], "block-%d" % b["n"])
        b["file"] = "%02d-%s.txt" % (b["n"], stem)
        with open(os.path.join(tbl_dir, b["file"]), "w") as fh:
            fh.write(b["text"] + "\n")

    with open(os.path.join(out_dir, "blocks.txt"), "w") as fh:
        fh.write(
            "Code blocks, in the order they appear.\n\n"
            "Medium has no tables, and these are monospace ASCII rather than\n"
            "tabular markup, so each one goes into a Medium CODE BLOCK:\n\n"
            "  type ``` on an empty line, or press Cmd-Option-6, then paste\n"
            "  with Cmd-Shift-V so no rich text comes along and splits it\n\n"
            "Medium's code column fits about 85 characters before it starts to\n"
            "scroll sideways. The widest here is "
            f"{max(b['widest'] for b in blocks)}.\n\n"
            + "=" * 72 + "\n"
        )
        for b in blocks:
            fh.write(
                f"\nBLOCK {b['n']}  [{b['lang']}]  {b['widest']} cols\n"
                f"section: {b['section']}\n"
                f"file:    blocks/{b['file']}\n"
                + "-" * 72 + "\n" + b["text"] + "\n" + "-" * 72 + "\n"
            )
    return blocks


def rasterise(svg, out_png, tmp_dir, index):
    """Render one SVG to PNG with theme colours resolved."""
    for var, hex_ in COLOURS.items():
        svg = svg.replace(f"var({var})", hex_)
    left = re.findall(r"var\(--[a-z-]+\)", svg)
    if left:
        die(f"figure {index}: unresolved custom properties {sorted(set(left))}. "
            "Add them to COLOURS.")

    vb = re.search(r'viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"', svg)
    if not vb:
        die(f"figure {index}: svg has no viewBox, cannot size the render")
    w, h = (int(float(vb.group(1))), int(float(vb.group(2))))
    # The site sizes SVGs with CSS; headless Chrome needs real attributes.
    svg = re.sub(r'style="width:100%;height:auto"', f'width="{w}" height="{h}"', svg)

    tmp_html = os.path.join(tmp_dir, f"{index}.html")
    with open(tmp_html, "w") as fh:
        fh.write(
            '<!doctype html><meta charset="utf-8"><style>'
            f"html,body{{margin:0;padding:{PAD}px;background:#fff;"
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,'
            "Arial,sans-serif}</style>" + svg
        )
    subprocess.run(
        [CHROME, "--headless", "--disable-gpu", "--hide-scrollbars",
         f"--force-device-scale-factor={SCALE}",
         "--default-background-color=FFFFFFFF",
         f"--window-size={w + 2 * PAD},{h + 2 * PAD}",
         f"--screenshot={out_png}", f"file://{tmp_html}"],
        capture_output=True, check=False,
    )
    if not os.path.exists(out_png):
        die(f"figure {index}: Chrome produced no PNG. Is Chrome at {CHROME}?")


def build(slug):
    if not os.path.exists(CHROME):
        die(f"Chrome not found at {CHROME}")

    post_path = find_post(slug)
    fm = frontmatter(post_path)
    body = rendered_body(slug)

    out_dir = os.path.join(ROOT, "_medium", slug)
    img_dir = os.path.join(out_dir, "images")
    tmp_dir = os.path.join(out_dir, ".tmp")
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(img_dir)
    os.makedirs(tmp_dir)

    blocks = extract_blocks(post_path, out_dir)
    figures = []

    def swap(match):
        svg, caption = match.group("svg"), match.group("cap")
        label = re.search(r'aria-label="([^"]*)"', svg)
        n = len(figures) + 1
        name = f"{n:02d}-{slugify(label.group(1) if label else '', f'figure-{n}')}.png"
        rasterise(svg, os.path.join(img_dir, name), tmp_dir, n)
        cap = re.sub(r"\s+", " ", caption).strip()
        figures.append({"n": n, "file": name, "caption": cap})
        return (
            f'\n<p style="padding:24px;background:#fafafa;border:1px dashed #bbb;'
            f'text-align:center;color:#555">UPLOAD IMAGE {n}: '
            f"images/{name}</p>\n<p><em>{cap}</em></p>\n"
        )

    body = re.sub(
        r"<figure>\s*(?P<svg><svg.*?</svg>)\s*"
        r"<figcaption>(?P<cap>.*?)</figcaption>\s*</figure>",
        swap, body, flags=re.S,
    )

    if "<svg" in body:
        die("an <svg> survived the figure swap; check the post's figure markup")

    # Site-relative links would 404 from Medium.
    site = "https://chaarangan.github.io"
    body = re.sub(r'href="/(?!/)', f'href="{site}/', body)

    title = fm.get("title", slug)
    subtitle = fm.get("description", "")
    canonical = f"{site}/blog/{slug}/"

    with open(os.path.join(out_dir, "article.html"), "w") as fh:
        fh.write(
            "<!doctype html>\n<html><head><meta charset=\"utf-8\">\n"
            f"<title>{title}</title>\n<style>\n"
            "body{max-width:700px;margin:40px auto;padding:0 20px;"
            "font:18px/1.6 Georgia,serif;color:#182420}\n"
            "h1{font:700 34px/1.2 -apple-system,Helvetica,sans-serif}\n"
            "h2{font:700 24px/1.3 -apple-system,Helvetica,sans-serif;margin-top:2em}\n"
            "pre{background:#f6f8f7;padding:14px;overflow-x:auto;"
            "font:13px/1.45 ui-monospace,Menlo,monospace}\n"
            "code{font:0.88em ui-monospace,Menlo,monospace;background:#f2f6f4;"
            "padding:1px 4px}\npre code{background:none;padding:0}\n"
            "em{color:#586761}\n</style></head><body>\n"
            f"<h1>{title}</h1>\n<p><strong>{subtitle}</strong></p>\n"
            f"{body}\n</body></html>\n"
        )

    with open(os.path.join(out_dir, "meta.txt"), "w") as fh:
        fh.write(
            f"title:     {title}\n"
            f"subtitle:  {subtitle}\n"
            f"tags:      {fm.get('tags', '')}\n"
            f"canonical: {canonical}\n\n"
            "Import (keeps SEO on your own domain):\n"
            f"  medium.com/p/import  ->  {canonical}\n\n"
            "Or paste article.html and set the canonical link by hand:\n"
            "  story settings (...) -> More settings -> Advanced settings\n\n"
            f"Figures to upload ({len(figures)}):\n"
            + "".join(f"  {f['n']}. images/{f['file']}\n     {f['caption']}\n"
                      for f in figures)
            + f"\nCode blocks to re-add ({len(blocks)}), see blocks.txt:\n"
            + "".join(f"  {b['n']}. blocks/{b['file']}  ({b['widest']} cols)\n"
                      for b in blocks)
            + "\nMedium has no tables. Each block goes in a Medium code block:\n"
              "  ``` on an empty line (or Cmd-Option-6), paste with Cmd-Shift-V\n"
        )

    json.dump(figures, open(os.path.join(out_dir, "figures.json"), "w"), indent=1)
    shutil.rmtree(tmp_dir)

    print(f"_medium/{slug}/")
    print(f"  article.html   paste this into Medium")
    print(f"  meta.txt       title, subtitle, tags, canonical URL")
    print(f"  blocks.txt     {len(blocks)} code blocks to re-add by hand")
    for f in figures:
        size = os.path.getsize(os.path.join(img_dir, f["file"])) // 1024
        print(f"  images/{f['file']}  ({size} KB)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    build(sys.argv[1].strip("/"))
