# Structure reference

The anatomy of a post on this site, section by section. SKILL.md holds the rules;
this file holds the shapes and worked patterns to build them with.

## The opening

Five beats, in this order, in 80 to 150 words:

| Beat | What it states | Shape |
|---|---|---|
| Stakes | what the thing does when it works | one sentence |
| Failure | where it breaks, with a number | one clause |
| Cost | what breaking it costs | one clause, priced |
| Reframe | the sentence that changes the shape of the problem | one sentence |
| Result | what this post gets, with a number | one sentence |

A flagship post follows the opening with the first figure, then a contents list:
one bullet per section, each carrying the number that section produces. The
contents list is a list of results, so a reader who stops there has still learned
something. One line of transition, then the first section.

## The reframe

Every post has one sentence that changes the shape of the problem: "the
bottleneck is the feed, not the GPU", "this is a parse, not an extraction".
Everything downstream is consequence. Find the reframe before drafting; a draft
without one is a survey.

## Section types

| Type | Heading pattern | Required content |
|---|---|---|
| Build step | `Parsing X into Y` | code, then `#### OUTPUT ####`, then the reading, then a diagram |
| Decision | `X, and why it is not Y` | the measurement that decided it, both options priced |
| Bug | `The X that never raised` | what looked fine, what was wrong, why nothing raised, the guard added |
| Iteration | `Version N, and the metric that caught it` | a version table, the metric that disagreed with the obvious one |
| Experiment | `Does X actually track Y?` | hypotheses written before the run, an ablation table, a verdict per hypothesis |
| Negative result | `X, built and measured and rejected` | what was built, the number, why it was dropped anyway |
| Ledger | `What it cost` | table of stage, resource, time, cost |
| Funnel | `Where X actually dies` | stage-by-stage survival counts, naming the binding constraint |
| Close | `Where this leaves us` | the five-part close below |

Across a flagship post, aim for roughly one heading in six to announce a failure
or a negative result.

## The repeating unit

Heading, setup, artifact, output, reading:

````markdown
## What the pipeline cost

The claim was that this needs no model calls at all. Here is the ledger.

```
#### OUTPUT ####
  stage                     resource        time    model calls
  -------------------------------------------------------------
  download corpus           network         ~4 min            0
  parse to edge tables      8 CPU cores     2.1 min           0
  embed abstracts           1 GPU           ~40 min           0
  -------------------------------------------------------------
  TOTAL                                                       0
```

Zero model calls end to end, in under an hour. The embedding time is projected
from measured throughput, not timed end to end.
````

The last clause labels the one number that is a projection rather than a
measurement. **Marking the weaker evidence is what makes the stronger evidence
believable.**

## Captions

A caption states the finding the figure proves. Test: read the caption alone. If
it teaches nothing, rewrite it.

| Label (rewrite) | Finding (keep) |
|---|---|
| `Ingestion pipeline` | `The parser waits on disk, not on CPU` |
| `Retrieval results` | `Recall rises while precision falls past k = 20` |
| `Figure 3: refusal rate` | `Refusals track missing evidence, gate by gate` |

## The close

Five parts, one short paragraph each:

1. **Set out**: what the post tried to do.
2. **Worked**: what held, with its number.
3. **Did not survive**: what failed, and the measurement that showed it.
4. **Recommendation**: what you would build now.
5. **Signature**: the pattern behind the errors, stated so it applies to the
   reader's system. This is the line that gets quoted and shared.

## Scaling down to a weekly post

A 900 to 1400 word weekly post keeps:

- the five-beat opening, at 80 to 120 words
- the reframe sentence
- 4 to 6 asserting headings
- one measured or runnable artifact
- 2 to 3 visuals with asserting captions
- one thing that did not work
- the five-part close

It drops the contents list, per-section code blocks, the ledger, the funnel and
numbered experiments.

## Site mechanics

- Frontmatter: `title`, `description`, `tags`. Layout comes from `_config.yml`
  defaults; leave it unset.
- Markdown is kramdown with GFM input; syntax highlighting is Rouge, themed off
  `--accent`/`--card`/`--line` so code follows the light/dark toggle.
- The right-rail TOC is built in JS from rendered H2/H3, so the headings are read
  as a standalone outline.
- Reading time is `number_of_words | divided_by: 200`.
- Existing tags live in `blog/tags/`. A new tag needs a stub from
  `scripts/sync_tag_pages.py`.
- Diagrams: inline SVG using the theme tokens, generated with the
  `diagram-design` skill, so they track the theme toggle.
- URLs are dateless (`/blog/:title/`), so write prose that will not age: name the
  date or version instead of "this year" or "recently".
- The closing line is the post's call to action; the site has no mailing list.
