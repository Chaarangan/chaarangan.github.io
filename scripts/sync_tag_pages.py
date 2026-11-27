#!/usr/bin/env python3
"""Keep blog/tags/*.md in step with the tags actually used in _posts/.

GitHub Pages builds Jekyll in safe mode, so jekyll-archives -- the gem that would
generate one page per tag -- is ignored. The alternative, filtering with
client-side JavaScript, produces no crawlable tag URLs, which works against the
posture in robots.txt and llms.txt. So each tag gets a real page, backed by a
three-line stub file, and this script makes sure the set of stubs matches the set
of tags rather than leaving it to memory.

Run it from the repo root after adding a post that introduces a new tag:

    python3 scripts/sync_tag_pages.py --check     # exit 1 if out of step
    python3 scripts/sync_tag_pages.py             # write the changes

Adding a post that reuses existing tags needs no run at all. A stub whose tag no
longer appears in any post is deleted, so /blog/tags/ never serves an empty page.

Stdlib only, matching update_stats.py -- no pip install, no credentials.
"""

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
POSTS = ROOT / "_posts"
TAGDIR = ROOT / "blog" / "tags"

FRONT_MATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)
# tags: [a, b]  |  tags: a b  |  tags:\n  - a\n  - b
INLINE_TAGS = re.compile(r"^tags:\s*(.+)$", re.MULTILINE)
BLOCK_TAG = re.compile(r"^\s*-\s*(\S.*?)\s*$", re.MULTILINE)

STUB = """---
layout: tag
tag: {tag}
title: "Posts tagged {tag}"
nav: blog
permalink: /blog/tags/{tag}/
---
"""

# A tag becomes a URL path segment, so keep it to something that survives one.
SAFE_TAG = re.compile(r"\A[a-z0-9]+(?:-[a-z0-9]+)*\Z")


def parse_tags(text):
    """Pull the tag list out of one post's YAML front matter."""
    fm = FRONT_MATTER.match(text)
    if not fm:
        return []
    block = fm.group(1)

    m = INLINE_TAGS.search(block)
    if not m:
        return []
    value = m.group(1).strip()

    if not value:
        # Block form: the entries are the "- item" lines that follow.
        rest = block[m.end():]
        # Stop at the next top-level key so a later list is not swallowed.
        stop = re.search(r"^\S", rest, re.MULTILINE)
        if stop:
            rest = rest[:stop.start()]
        return [t.strip().strip("\"'") for t in BLOCK_TAG.findall(rest)]

    value = value.strip("[]")
    return [t.strip().strip("\"'") for t in value.split(",") if t.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="report drift and exit 1 without writing")
    args = ap.parse_args()

    if not POSTS.is_dir():
        sys.exit(f"no _posts directory at {POSTS}")

    wanted = set()
    for post in sorted(POSTS.glob("*.md")) + sorted(POSTS.glob("*.markdown")):
        for tag in parse_tags(post.read_text(encoding="utf-8")):
            if not SAFE_TAG.match(tag):
                # Refuse rather than emit a stub at a URL that will not match the
                # link post-card.html builds for the same tag.
                sys.exit(
                    f"{post.name}: tag {tag!r} is not URL-safe. Use lowercase "
                    f"letters, digits, and single hyphens (e.g. 'edge-ai')."
                )
            wanted.add(tag)

    TAGDIR.mkdir(parents=True, exist_ok=True)
    have = {p.stem for p in TAGDIR.glob("*.md")}

    to_add = sorted(wanted - have)
    to_remove = sorted(have - wanted)

    if not to_add and not to_remove:
        print(f"blog/tags/ already in step with _posts/ ({len(wanted)} tags).")
        return

    if args.check:
        for tag in to_add:
            print(f"missing: blog/tags/{tag}.md")
        for tag in to_remove:
            print(f"stale:   blog/tags/{tag}.md")
        sys.exit("blog/tags/ is out of step -- run scripts/sync_tag_pages.py")

    for tag in to_add:
        (TAGDIR / f"{tag}.md").write_text(STUB.format(tag=tag), encoding="utf-8")
        print(f"+ blog/tags/{tag}.md")
    for tag in to_remove:
        (TAGDIR / f"{tag}.md").unlink()
        print(f"- blog/tags/{tag}.md")


if __name__ == "__main__":
    main()
