#!/usr/bin/env python3
"""Refresh the live stats embedded in index.html.

Every number that grows on its own lives in the page wrapped in a marker, e.g.

    peer-reviewed publications with <span data-stat="citations">245</span> citations

This script fetches the current value for each marker and rewrites the text
inside it. Run it from the repo root:

    python3 scripts/update_stats.py --dry-run   # show what would change
    python3 scripts/update_stats.py             # write the changes

Sources are independent: one that fails leaves its number at the committed
value and the rest still update. Fetch failures are warnings, not errors, so a
Google Scholar captcha does not turn the weekly run red. A marker that has gone
missing from the page IS an error, since that means the page and this script
have drifted apart.

Stdlib only, so the workflow needs no pip install. No credentials are required:
PEPY_API_KEY is honoured if present but is not needed, since pepy's open endpoint
serves the same data.
"""

import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX_HTML = os.path.join(REPO_ROOT, "index.html")

SCHOLAR_URL = "https://scholar.google.com/citations?hl=en&user=-tDp1vUAAAAJ"

# Scholar decides per client address whether to serve the profile or a 403, and
# the decision holds for the whole run. Two things were tried here and removed
# because measurement on a real runner disproved both:
#
#   - A public CORS proxy, so Scholar would see the proxy instead of the runner.
#     Worked from a home connection, answered a runner with 408/500/522 every
#     time.
#   - Rotating Scholar's regional hosts, on the theory that separate frontends
#     block separately. They 403 in lockstep: .co.uk, .de and .ca all refused
#     within the same run that .com refused.
#
# What does vary is the address itself, which differs run to run: one run was
# served the page directly while another was refused eight times. So the useful
# lever is more attempts across more runs, not more attempts inside one run,
# which is why this schedule is daily and a refused run simply keeps the value it
# already has. A couple of quick retries remain for ordinary network flakiness.
SCHOLAR_ATTEMPTS = 2
SCHOLAR_PAUSE = 5

HF_URL = (
    "https://huggingface.co/api/models/Charangan/MedBERT"
    "?expand[]=downloadsAllTime"
)

# pepy serves the same v2 payload from two hosts: the site host needs no
# credentials, while the api host demands a key and then answers 403 to the free
# tier anyway. Prefer the one that works and keep the keyed host as a fallback
# for if the open endpoint ever closes.
PEPY_URL = "https://pepy.tech/api/v2/projects/nerp"
PEPY_KEYED_URL = "https://api.pepy.tech/api/v2/projects/nerp"

GITHUB_REPO_URL = "https://api.github.com/repos/Chaarangan/stepgate"

# npm has no all-time endpoint, and a range query is capped at 18 months, so the
# total is summed in 365-day windows from the package's creation date.
NPM_REGISTRY_URL = "https://registry.npmjs.org/stepgate"
NPM_RANGE_URL = "https://api.npmjs.org/downloads/range/{start}:{end}/stepgate"
NPM_WINDOW_DAYS = 365

# Scholar serves the profile page only to something that looks like a browser.
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# The JSON APIs are happy to be told who we are, but pepy rejects urllib's
# default "Python-urllib/3.x" with a 403, so this has to be set explicitly.
BOT_UA = "chaarangan.github.io stats bot (+https://chaarangan.github.io)"

TIMEOUT = 30

warnings = []


def warn(message):
    """Record a non-fatal problem and surface it in the Actions run."""
    warnings.append(message)
    print(f"::warning::{message}")


def fetch(url, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.read().decode("utf-8", errors="replace")


def parse_scholar(html):
    """Pull the metrics table out of a Scholar profile page.

    The table holds six cells in a fixed order: citations all-time, citations
    since, h-index all-time, h-index since, i10 all-time, i10 since. We want the
    all-time figures, so cells 0, 2 and 4.
    """
    cells = re.findall(r'class="gsc_rsb_std">(\d+)</td>', html)
    if len(cells) < 6:
        if "unusual traffic" in html.lower() or "not a robot" in html.lower():
            raise ValueError("served a captcha instead of the profile")
        raise ValueError(f"expected 6 metric cells, found {len(cells)}")
    return {
        "citations": int(cells[0]),
        "h_index": int(cells[2]),
        "i10_index": int(cells[4]),
    }


def fetch_scholar():
    """Citations, h-index and i10-index from the Scholar profile.

    Keeps every failure reason rather than just the last, so a 403 (this run's
    address is refused, try again tomorrow) stays distinguishable from a parse
    failure (Scholar changed its markup and this script needs updating).
    """
    headers = {"User-Agent": BROWSER_UA, "Accept-Language": "en-US,en"}
    failures = []

    for attempt in range(1, SCHOLAR_ATTEMPTS + 1):
        if attempt > 1:
            time.sleep(SCHOLAR_PAUSE)
        try:
            return parse_scholar(fetch(SCHOLAR_URL, headers))
        except (urllib.error.URLError, ValueError, OSError) as error:
            failures.append(f"attempt {attempt}: {error}")

    raise ValueError("; ".join(failures))


def fetch_huggingface():
    """All-time downloads for the MedBERT model."""
    payload = json.loads(fetch(HF_URL, {"User-Agent": BOT_UA}))
    total = payload.get("downloadsAllTime")
    if total is None:
        raise ValueError("HuggingFace response has no downloadsAllTime field")
    return {"hf_downloads": int(total)}


def fetch_pypi():
    """All-time downloads for NERP, including mirror traffic.

    Tries the open endpoint first and the keyed one only if that fails, since a
    free-tier key gets a 403 from the api host. Setting PEPY_API_KEY is therefore
    optional; it exists purely as insurance.
    """
    attempts = [("open endpoint", PEPY_URL, {"User-Agent": BOT_UA})]
    api_key = os.environ.get("PEPY_API_KEY", "").strip()
    if api_key:
        attempts.append(
            ("keyed endpoint", PEPY_KEYED_URL, {"User-Agent": BOT_UA, "X-API-Key": api_key})
        )

    failures = []
    for label, url, headers in attempts:
        try:
            payload = json.loads(fetch(url, headers))
            total = payload.get("total_downloads")
            if total is None:
                raise ValueError("response has no total_downloads field")
            return {"pypi_downloads": int(total)}
        except (urllib.error.URLError, ValueError, json.JSONDecodeError, OSError) as error:
            failures.append(f"{label}: {error}")
    raise ValueError("; ".join(failures))


def fetch_github():
    """Stars and forks for the Stepgate repository.

    GITHUB_TOKEN is optional; it lifts the 60-an-hour anonymous limit, which a
    shared runner address can already have spent.
    """
    headers = {"User-Agent": BOT_UA, "Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    payload = json.loads(fetch(GITHUB_REPO_URL, headers))
    stars = payload.get("stargazers_count")
    forks = payload.get("forks_count")
    if stars is None or forks is None:
        raise ValueError("GitHub response has no stargazers_count or forks_count field")
    return {"gh_stars": int(stars), "gh_forks": int(forks)}


def fetch_npm():
    """All-time downloads for the Stepgate npm package."""
    registry = json.loads(fetch(NPM_REGISTRY_URL, {"User-Agent": BOT_UA}))
    created = registry.get("time", {}).get("created")
    if created is None:
        raise ValueError("npm registry response has no time.created field")
    start = datetime.date.fromisoformat(created[:10])
    today = datetime.datetime.now(datetime.timezone.utc).date()

    total = 0
    while start <= today:
        end = min(start + datetime.timedelta(days=NPM_WINDOW_DAYS - 1), today)
        url = NPM_RANGE_URL.format(start=start.isoformat(), end=end.isoformat())
        payload = json.loads(fetch(url, {"User-Agent": BOT_UA}))
        days = payload.get("downloads")
        if days is None:
            raise ValueError(f"npm range {start}:{end} response has no downloads field")
        total += sum(day["downloads"] for day in days)
        start = end + datetime.timedelta(days=1)
    return {"npm_downloads": total}


SOURCES = [
    ("Google Scholar", fetch_scholar),
    ("HuggingFace", fetch_huggingface),
    ("PyPI", fetch_pypi),
    ("GitHub", fetch_github),
    ("npm", fetch_npm),
]

# How many times each marker is expected to appear in index.html. Checked on
# every run: a mismatch means the page was edited without updating this map, and
# silently updating two of three mentions would leave a stale number on the
# page. Bump the count here when you add or remove a mention.
EXPECTED_MARKERS = {
    "citations": 1,  # research heading
    "h_index": 1,
    "i10_index": 1,
    "hf_downloads": 1,
    "pypi_downloads": 1,
    "gh_stars": 1,
    "gh_forks": 1,
    "npm_downloads": 1,
}

# Stars can be withdrawn and forks deleted, so these may legitimately go down.
SHRINKABLE = {"gh_stars", "gh_forks"}

# A tenfold jump is only suspect on a count that is already large: 7 stars to 80
# is an ordinary good week, and refusing it would pin the page at 7 for good.
JUMP_FLOOR = 100


def marker_pattern(key):
    """Match a marked element and capture its opening tag, text and closing tag.

    Deliberately refuses to match nested markup: if a marker ever wraps
    something more complex than a bare number we want a loud miss, not a
    mangled page.
    """
    return re.compile(
        r'(<(?P<tag>\w+)[^>]*\bdata-stat="' + re.escape(key) + r'"[^>]*>)'
        r"(?P<text>[^<]*)"
        r"(</(?P=tag)>)"
    )


def current_value(html, key):
    """The value sitting in the page today.

    Returns (number, exact). A trailing "+" means the number in the page is a
    rounded claim rather than a real reading, so it carries no authority and we
    skip the plausibility checks against it.
    """
    match = marker_pattern(key).search(html)
    if not match:
        return None, False
    text = match.group("text").strip()
    digits = text.replace(",", "").rstrip("+")
    if not digits.isdigit():
        return None, False
    return int(digits), not text.endswith("+")


def plausible(key, new, old, exact):
    """Guard against writing garbage into the page.

    Most of these counters only ever go up, so a drop means we parsed a captcha
    page or a changed layout rather than real data; SHRINKABLE keys are exempt.
    A sudden order-of-magnitude jump past JUMP_FLOOR is equally suspect. Neither
    check applies when the page's current number is a rounded claim.
    """
    if new <= 0:
        warn(f"{key}: refusing to write a non-positive value ({new})")
        return False
    if old is None or not exact:
        return True
    if new < old and key not in SHRINKABLE:
        warn(f"{key}: fetched {new} but page has {old}; counters do not shrink, keeping {old}")
        return False
    if new > max(old, JUMP_FLOOR) * 10:
        warn(f"{key}: fetched {new} against {old} in the page; implausible jump, keeping {old}")
        return False
    return True


def apply_value(html, key, value):
    """Rewrite the text inside every marker for a key. Returns (html, changed)."""
    formatted = f"{value:,}"
    previous = set()

    def substitute(match):
        previous.add(match.group("text"))
        return match.group(1) + formatted + match.group(4)

    new_html, count = marker_pattern(key).subn(substitute, html)
    expected = EXPECTED_MARKERS[key]
    if count != expected:
        raise KeyError(
            f'expected {expected} data-stat="{key}" marker(s) in index.html, found {count}'
        )
    return new_html, previous != {formatted}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would change without writing index.html",
    )
    args = parser.parse_args()

    with open(INDEX_HTML, encoding="utf-8") as handle:
        html = original = handle.read()

    fetched = {}
    for name, fetcher in SOURCES:
        try:
            fetched.update(fetcher())
        except (urllib.error.URLError, ValueError, json.JSONDecodeError, OSError) as error:
            warn(f"{name} lookup failed: {error}")

    updates = []
    for key, value in sorted(fetched.items()):
        old, exact = current_value(html, key)
        if not plausible(key, value, old, exact):
            continue
        try:
            html, changed = apply_value(html, key, value)
        except KeyError as error:
            print(f"::error::{error.args[0]}", file=sys.stderr)
            return 1
        if changed:
            updates.append((key, old, value))
            print(f"{key}: {old} -> {value:,}")
        else:
            print(f"{key}: {value:,} (unchanged)")

    if args.dry_run:
        print("\n--dry-run, index.html not written.")
    elif html != original:
        with open(INDEX_HTML, "w", encoding="utf-8") as handle:
            handle.write(html)
        print(f"\nWrote index.html ({len(updates)} value(s) updated).")
    else:
        print("\nNothing to write.")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        lines = ["## Live stats refresh", ""]
        lines += [f"- `{k}`: {o} → **{n:,}**" for k, o, n in updates] or ["- No changes."]
        if warnings:
            lines += ["", "### Warnings", ""] + [f"- {w}" for w in warnings]
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
