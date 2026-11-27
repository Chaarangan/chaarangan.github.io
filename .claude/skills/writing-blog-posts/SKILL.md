---
name: writing-blog-posts
description: Use when drafting, outlining, researching, or revising a post for chaarangan.github.io, or when asked to turn a topic from the blog content plan into an article. Also use when reviewing a draft that reads thin, unsupported, or under-illustrated.
---

# Writing blog posts

## Core principle

**A claim without evidence is a blog post nobody remembers.** Every section must
reach a measurement or a runnable artifact, or say plainly that it does not.

A post opens with a number, builds one component at a time, shows real console
output under each step, and publishes the things that failed. Read
`structure-reference.md` before outlining: it holds the opening beats, section
types, a worked section, caption patterns and the close.

## The constraint that shapes everything

The author cannot publish measurements or implementation detail from their
employer's platform. Posts cover the problem and the technique only, never the
employer's implementation.

**The way out is the artifact bridge.** Build the smallest public reproduction
that exhibits the same failure, measure *that*, publish the code. A toy corpus,
a public dataset, a 200-line script. This converts unpublishable experience into
a publishable measurement and is the single highest-value move available. Reach
for it before settling for assertion.

## Two post shapes

| | Weekly | Flagship |
|---|---|---|
| Words | 900–1400 | 2000–3500 |
| H2 sections | 4–6 | 8–14 |
| Visuals | 2–3 | 1 per ~500 words |
| Measured numbers | ≥1 | throughout |
| Negative result | encouraged | **required** |
| Cadence | most Saturdays | ~1 per month |

Default to Weekly. Flagship earns its length only when there is a real artifact
to build and measure.

## Evidence ladder

Rank every claim before drafting. Aim to spend the post at levels 1–3.

1. **Measured** — a number from a run you can describe. Strongest.
2. **Artifact** — runnable code, config, or repo the reader can execute.
3. **Referenced** — named public library behaviour, docs, a paper. Checkable.
4. **Reasoned** — argument from stated premises. Say so in the prose.
5. **Asserted** — bare claim. Budget: near zero.

**Rule:** every H2 must hit level 1 or 2 at least once, or state what it is not
showing. A post that is entirely level 3–4 is an opinion piece; that is allowed,
but decide it deliberately rather than by drift.

## The repeating section unit

Every H2 follows the same five beats:

1. Heading that carries a claim, a tension, or a number
2. One to three short paragraphs of setup and stakes
3. The artifact — code block, config, or diagram
4. The result — real output, a table, or a measured figure
5. One or two sentences reading what the result means

Then move on. No summary paragraph between sections.

## Headings

Headings must assert. The TOC rail is built from H2/H3, so the heading list is
read on its own and has to work as an outline.

- Good: `Weights are not the artifact` · `The cache miss that never logged` ·
  `The reranker, built and measured and rejected` · `Why the index is not one shard`
- Banned: `Introduction` · `Overview` · `Background` · `The solution` ·
  `Best practices` · `Conclusion` · `Takeaway` · `Final thoughts`

Formulas that work: *"X, and why Y"*, *"X, the Y we did not have to Z"*,
*"The X that never Y"*, *"Why X is not Y"*.

## Opening: five beats, under 150 words

**Stakes → Cost → Reframe → Result → Contents.**

State what the thing does in one sentence. Say where it breaks, with a number.
Give the cost of breaking. Deliver the reframe that changes the shape of the
problem. State the result. Then a bulleted contents list of what the post builds,
one line per section, each carrying its own number.

Open on a concrete scene or a hard figure. Never on a definition and never on
"In today's fast-moving landscape".

## Visuals

One primary diagram per major section, minimum two per post. Generate with the
`diagram-design` skill. Inline SVG using the site's theme tokens so one drawing
works in both light and dark; never a raster screenshot of a diagram.

**Captions assert a finding.** They are not labels.

- Good: `The parser waits on disk, not on CPU` ·
  `Recall rises while precision falls past k = 20` ·
  `Refusals track missing evidence, gate by gate`
- Bad: `System architecture` · `Figure 2: the pipeline` · `Overview of the flow`

Pick the type by the job: dependency graph for what breaks, sequence for order of
operations, quadrant for trade-offs, funnel for where things die, treemap for
cost attribution, line/bar for measured runs. A diagram that restates the
paragraph above it is decoration — cut it.

## Results and tables

Show real output, not prose about output. Fence it and label it:

```
#### OUTPUT ####
  stage                          resource        time    calls
  ---------------------------------------------------------------
  parse to edge tables           8 CPU cores     2.1m        0
```

Every flagship post ends with a **cost ledger** (what it took) or a **funnel**
(where things died). Both are tables. Both are what a reviewer asks for.

## The negative result

**Required in every flagship post, encouraged in every weekly one.** At least one
of:

- something built, measured, and rejected
- a bug that never raised
- a metric that improved while the system got worse
- a hypothesis written down before a run, then falsified

This is the highest-credibility element in the entire format and the one an agent
drafting from scratch will always omit. Do not let a post ship without asking
what failed.

## Closing

Heading states a position: `Where this leaves us`, `What survived`,
`What I would build differently`. Then, in order:

1. What you set out to do
2. What worked, with the number
3. What did not survive
4. What you would recommend now
5. The generalisable signature of the errors

Close on the reader's system, not on a summary. There are no comments and no
mailing list on this site, so the last line is the only call to action there is.

## Before drafting: research checklist

- [ ] Exact library defaults, env var names, and file names, so claims are checkable
- [ ] The version where the behaviour holds — defaults change
- [ ] Prior art: who already wrote this, and what this post adds
- [ ] One counter-example or the condition under which the advice fails
- [ ] A public dataset or repo to build the artifact against
- [ ] The measurement you will run, decided before the draft

## Pre-publish checklist

- [ ] Frontmatter: `title`, `description`, `tags` (existing tags in `blog/tags/`;
      new ones need `scripts/sync_tag_pages.py`)
- [ ] The one repeatable sentence a reader can say to a colleague on Monday
- [ ] Every H2 reaches evidence level 1 or 2, or admits it does not
- [ ] Visual budget met; every caption asserts something
- [ ] At least one thing that failed
- [ ] No employer measurements or implementation detail
- [ ] Metrics rationed — one figure per specific claim, not a résumé dump
- [ ] Run the `humanizer` skill over the full draft
- [ ] No banned heading survived

## Common mistakes

| Mistake | Fix |
|---|---|
| No numbers because the real system is confidential | Build the artifact bridge and measure that |
| One diagram for 1400 words | Budget one per major section |
| Caption labels the picture | Caption states what the picture proves |
| Only the ecosystem's failures, none of yours | Add the thing you built and rejected |
| `## Takeaway` as the closer | Close on a position and the reader's system |
| Summary paragraph between every section | Cut it; the reading sentence already did that job |
| Evidence tier known to the author but invisible to the reader | Say "this is reasoned, not measured" in the prose |
