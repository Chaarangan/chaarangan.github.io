---
title: "A per-token cost of zero is not a cost of zero"
description: "Memory, evaluation, and guardrail calls took 53% to 61% of the GPU across four models but only 27% to 37% of the output tokens. On hardware you own, the first number is the one that predicted the throughput I measured one session at a time."
tags: [agents, on-prem, inference]
---

An agent that answers questions over your documents makes more model calls than
the ones you wrote. Memory compaction, an LLM-as-judge score, a guardrail check
on the way in and another on the way out. Across four models and two families,
those unwritten calls took 52.8% to 61.4% of the GPU. The same calls were 27% to
37% of the output tokens, and that is the number most dashboards show you.

Debmalya Biswas recently put a number on this. Non-functional aspects, memory,
evals and guardrails, "can lead to 2-3 times more LLM invocations than those
invoked to directly execute the agent functionality"
([Tokenomics: FinOps for the Agentic Harness](https://aiadvances.org/tokenomics-for-the-agentic-harness-41dbaa822f7f)).
The article does not stop at the invoice either: it sizes the self-hosted case
too, down to whether the model fits in one GPU and how batch size trades against
latency, and proposes an OpenTelemetry attribute set so the calls can be costed.

What it left me wanting was the conversion. A count of invocations, and the token
totals the standard attributes record, are both things I can log. Neither told me
what those calls would cost on a box I had already bought, where the marginal
token is free and the overhead lands on a budget no finance process watches: how
many people you can serve before the machine falls over.

This post builds a harness and measures that on a 36 GB M3 Max.

- Why output-token accounting reports the overhead with the wrong sign, and why
  input-token accounting is no better
- Whether the result survives a change of model family and a 20x span in weights
- What happens to the overhead share as a session gets longer
- What rewriting the front of your context costs: 31x on every later call
- How continuous batching hides the harness until the box saturates
- Which of weights and KV reservation actually sets resident memory

## Two accounting methods, opposite conclusions

The harness runs a toy agent over a synthetic corpus and tags every invocation
as either *functional* (plan, answer) or *overhead* (guard in, compact, judge,
guard out). Ollama reports prefill and decode durations separately, so a call
can be charged for occupancy instead of merely counted.

Two shortcuts are worth declaring up front. The judge and the outbound guard get
a placeholder where the generated answer would go, a short string naming its
length, because this harness measures occupancy and never reads what the model
wrote. And what the compaction and judge steps read as the session state is the
question plus the retrieved documents, not an accumulated transcript with the
plan and the answer in it. Both shortcuts shrink prompts that a real system would
grow, so both understate the overhead share below.

Prefill and decode carry the whole argument. Prefill is the model reading the
prompt, and its cost scales with how many tokens you hand it. Decode is the
model writing the reply, one token at a time, and its cost scales with how many
tokens come back. A hosted API bills for both and weights the bill toward
decode. On a GPU you own, both occupy the same hardware and the weighting is
irrelevant.

```python
@dataclass
class Call:
    cls: str          # "functional" | "overhead"
    step: str
    ...
    prompt_tokens: int
    output_tokens: int
    prefill_s: float
    decode_s: float

    @property
    def gpu_s(self) -> float:
        return self.prefill_s + self.decode_s
```

Context length is pinned with `num_ctx` for every model, because the daemon
default of 131,072 would not fit a 23 GB model on this machine, and because a
comparison across model sizes is meaningless if each one gets a different
reservation. Three sessions on `qwen3:4b`:

```
#### OUTPUT ####
  step        class       calls  in tok  out tok  prefill  decode   gpu s  % gpu
  ------------------------------------------------------------------------------
  answer      functional      3    4956      384     2.2s    5.3s    7.5s  30.6%
  compact     overhead        3    4974      192     5.0s    2.5s    7.5s  30.3%
  judge       overhead        3    5025       48     5.1s    0.6s    5.7s  23.3%
  plan        functional      3     116      192     0.2s    2.2s    2.5s  10.1%
  guard_in    overhead        3     128       48     0.2s    0.5s    0.7s   2.9%
  guard_out   overhead        3     108       48     0.1s    0.6s    0.7s   2.8%

  overhead:functional  out-tok 0.58x   gpu 1.46x   overhead = 59.3% of gpu
```

The 2:1 call ratio is a design choice, not a discovery: I wrote four overhead
steps and two functional ones. The divergence in the last line is the part I did
not choose. Counted in output tokens the overhead is 0.58x the functional work,
barely half. Counted in GPU-seconds it is 1.46x. The two methods put the overhead
on opposite sides of break-even.

## The call that writes 16 tokens and takes a fifth of the box

Look at `judge`. Across three sessions it produced 48 output tokens and consumed
23.3% of the GPU. That is 76% of what the `answer` call cost while producing one
eighth of the output.

48 tokens over three calls is 16 each, which is exactly the `num_predict` ceiling
the harness sets for that step, so on this model the judge was cut off before it
finished. On the 1.7B and the 35B it stopped on its own after two tokens.

The explanation is the prefill column. `judge` spent 5.1s reading and 0.6s
writing. `answer` spent 2.2s reading and 5.3s writing. The two expensive overhead
steps are prefill-bound because they re-read the session: compaction reads the
transcript and the judge reads it again. The two guardrails read only the
question, which is why they sit at the bottom of the ledger at 2.9% and 2.8%.

That is where the harness parts company with the usual rule of thumb. Biswas
cites the standard split, that "in most requests prefill takes less than 20% of
the end-to-end latency, while decoding takes more than 80%". My `plan` call obeys
it exactly, 0.2s reading against 2.2s writing, 8% prefill, and `answer` is close
enough at 29%. The two expensive overhead calls inverted it: `compact` is 67%
prefill and `judge` is 89%. Across the whole harnessed session prefill took 52%
of the GPU. The 20/80 rule describes a short prompt and a long answer, which is
what the functional calls are. The non-functional calls are the other shape.

<figure>
<svg viewBox="0 0 700 300" role="img" aria-label="GPU seconds per step split into prefill and decode" style="width:100%;height:auto">
  <text x="0" y="16" fill="var(--ink)" font-size="13" font-weight="600">GPU-seconds per step, qwen3:4b, three sessions</text>
  <rect x="0" y="28" width="11" height="11" fill="var(--accent-soft)" stroke="var(--accent)"/>
  <text x="17" y="38" fill="var(--ink-soft)" font-size="11">prefill (reading)</text>
  <rect x="120" y="28" width="11" height="11" fill="var(--accent)"/>
  <text x="137" y="38" fill="var(--ink-soft)" font-size="11">decode (writing)</text>
  <g font-size="12">
    <text x="96" y="70" text-anchor="end" fill="var(--accent)" font-weight="600">answer</text>
    <rect x="108" y="59" width="139" height="15" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <rect x="247" y="59" width="335" height="15" fill="var(--accent)"/>
    <text x="590" y="71" fill="var(--ink)">7.5s</text>

    <text x="96" y="104" text-anchor="end" fill="var(--ink-soft)">compact</text>
    <rect x="108" y="93" width="316" height="15" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <rect x="424" y="93" width="158" height="15" fill="var(--accent)"/>
    <text x="590" y="105" fill="var(--ink)">7.5s</text>

    <text x="96" y="138" text-anchor="end" fill="var(--ink-soft)">judge</text>
    <rect x="108" y="127" width="322" height="15" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <rect x="430" y="127" width="38" height="15" fill="var(--accent)"/>
    <text x="476" y="139" fill="var(--ink)">5.7s</text>

    <text x="96" y="172" text-anchor="end" fill="var(--accent)" font-weight="600">plan</text>
    <rect x="108" y="161" width="13" height="15" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <rect x="121" y="161" width="145" height="15" fill="var(--accent)"/>
    <text x="274" y="173" fill="var(--ink)">2.5s</text>

    <text x="96" y="206" text-anchor="end" fill="var(--ink-soft)">guard_in</text>
    <rect x="108" y="195" width="13" height="15" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <rect x="121" y="195" width="31" height="15" fill="var(--accent)"/>
    <text x="160" y="207" fill="var(--ink)">0.7s</text>

    <text x="96" y="240" text-anchor="end" fill="var(--ink-soft)">guard_out</text>
    <rect x="108" y="229" width="6" height="15" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <rect x="114" y="229" width="38" height="15" fill="var(--accent)"/>
    <text x="160" y="241" fill="var(--ink)">0.7s</text>
  </g>
  <line x1="108" y1="256" x2="582" y2="256" stroke="var(--line)"/>
  <text x="108" y="276" fill="var(--ink-soft)" font-size="11">Functional steps in green. The two big overhead calls are the ones made of reading.</text>
</svg>
<figcaption>Compaction cost the same as answering the question, and wrote half as much.</figcaption>
</figure>

## The same three sessions on three more models

One model family proves nothing, and a 4B model is small enough that its fast
decode could be flattering the overhead. So the same three sessions ran on four
models: two sizes of Qwen 3, a Gemma 3 of matching size for a family check, and
a 35B mixture-of-experts with 3B active parameters for a scale check.

```
#### OUTPUT ####
  model               resident     decode  out-tok     gpu  overhead % of gpu
  ----------------------------------------------------------------------------
  qwen3:1.7b             2.4GB     147t/s    0.52x   1.45x              59.1%
  qwen3:4b               3.9GB      78t/s    0.58x   1.46x              59.3%
  gemma3:4b              3.9GB      80t/s    0.60x   1.59x              61.4%
  qwen3.5:35b-a3b       23.3GB      60t/s    0.38x   1.12x              52.8%
```

The overhead share lands between 52.8% and 61.4% across two independent model
families. The parameter span is 20x by weights, which is what sets the memory
footprint, but the 35B activates only 3B of those per token, so in compute terms
the spread is nearer 2x. It is a stronger check on architecture than on scale.

The 35B does have the lowest share, though not for the reason I first wrote down.
I had it as slower decode making the decode-heavy `answer` call dearer. The rates
say otherwise. Across the whole ledger the 35B prefilled at 727 tokens a second
against the 4B's 1,196, a slowdown of 1.65x, while its decode slowed by only 1.3x.
On those numbers a prefill-bound overhead share should go up, not down.

Part of the answer is the output column. The 35B's judge and outbound guard each
stopped after two tokens where the 4B ran into its 16-token ceiling, so the
overhead wrote 210 tokens where the 4B wrote 336. Had it written the 4B's total at
its own decode rate the ratio would land at 1.26 instead of 1.12, which recovers
about 40% of the drop from 1.46. The rest sits on the functional side, whose
prefill rose 2.9x against the overhead's 1.4x. I have not isolated why.

The column that matters is `out-tok`. On every model tested it sits between 0.38x
and 0.60x while GPU-seconds sit between 1.12x and 1.59x. Output-token counting
puts the overhead below break-even on all four; GPU time puts it above on all
four.

Counting input tokens instead does not rescue the method, it only moves the error.
The overhead reads 2.02x what the functional calls read, identical to two decimal
places on all four models, against a true GPU cost of 1.12x to 1.59x. So the
output column reports between a third and two fifths of what the box charges, and
the input column reports 1.3x to 1.8x of it. Neither lands on the real number.
That matters for anyone instrumenting with the standard attributes, because
`input_tokens` happens to sit near the 2-3x range the invocation count implies,
which makes it look like a confirmation when it is a coincidence.

<figure>
<svg viewBox="0 0 700 275" role="img" aria-label="Overhead to functional ratio measured in output tokens and in GPU seconds, for four models" style="width:100%;height:auto">
  <text x="0" y="16" fill="var(--ink)" font-size="13" font-weight="600">overhead : functional, measured two ways</text>
  <rect x="0" y="30" width="11" height="11" fill="var(--ink-soft)" opacity="0.45"/>
  <text x="17" y="40" fill="var(--ink-soft)" font-size="11">output tokens</text>
  <rect x="120" y="30" width="11" height="11" fill="var(--accent)"/>
  <text x="137" y="40" fill="var(--ink-soft)" font-size="11">GPU-seconds</text>
  <line x1="438" y1="46" x2="438" y2="240" stroke="var(--ink-soft)" stroke-width="1.5" stroke-dasharray="4 4"/>
  <text x="438" y="40" fill="var(--ink-soft)" font-size="11" text-anchor="middle">break-even</text>
  <g font-size="12">
    <text x="140" y="82" text-anchor="end" fill="var(--ink)">qwen3:1.7b</text>
    <rect x="150" y="64" width="150" height="11" fill="var(--ink-soft)" opacity="0.45"/>
    <text x="306" y="73" fill="var(--ink-soft)" font-size="10">0.52x</text>
    <rect x="150" y="79" width="418" height="11" fill="var(--accent)"/>
    <text x="574" y="88" fill="var(--ink)" font-size="10">1.45x</text>
    <text x="140" y="130" text-anchor="end" fill="var(--ink)">qwen3:4b</text>
    <rect x="150" y="112" width="167" height="11" fill="var(--ink-soft)" opacity="0.45"/>
    <text x="323" y="121" fill="var(--ink-soft)" font-size="10">0.58x</text>
    <rect x="150" y="127" width="421" height="11" fill="var(--accent)"/>
    <text x="577" y="136" fill="var(--ink)" font-size="10">1.46x</text>
    <text x="140" y="178" text-anchor="end" fill="var(--ink)">gemma3:4b</text>
    <rect x="150" y="160" width="173" height="11" fill="var(--ink-soft)" opacity="0.45"/>
    <text x="329" y="169" fill="var(--ink-soft)" font-size="10">0.60x</text>
    <rect x="150" y="175" width="458" height="11" fill="var(--accent)"/>
    <text x="614" y="184" fill="var(--ink)" font-size="10">1.59x</text>
    <text x="140" y="226" text-anchor="end" fill="var(--ink)">qwen3.5:35b-a3b</text>
    <rect x="150" y="208" width="110" height="11" fill="var(--ink-soft)" opacity="0.45"/>
    <text x="266" y="217" fill="var(--ink-soft)" font-size="10">0.38x</text>
    <rect x="150" y="223" width="323" height="11" fill="var(--accent)"/>
    <text x="479" y="232" fill="var(--ink)" font-size="10">1.12x</text>
  </g>
  <line x1="150" y1="240" x2="640" y2="240" stroke="var(--line)"/>
  <g font-size="10" fill="var(--ink-soft)"><text x="150" y="255" text-anchor="middle">0.0x</text><text x="294" y="255" text-anchor="middle">0.5x</text><text x="438" y="255" text-anchor="middle">1.0x</text><text x="582" y="255" text-anchor="middle">1.5x</text></g>
</svg>
<figcaption>Every model puts the two measures on opposite sides of break-even.</figcaption>
</figure>

## The share I expected to climb, and it did not

Before running it I wrote down a prediction: since prefill scales with context
and an agent session only grows, the overhead share should climb as the session
ages. Eight turns of a growing transcript on `qwen3:4b`:

```
#### OUTPUT ####
   turn  ctx tok  func gpu  over gpu  overhead % of gpu
  ------------------------------------------------------
      1      838      2.5s      2.6s              51.3%
      2     1033      1.8s      1.5s              44.5%
      3     1221      1.9s      1.5s              44.7%
      4     1409      1.9s      1.5s              43.9%
      5     1610      1.9s      1.5s              44.8%
      6     1792      1.9s      1.5s              44.5%
      7     1987      1.9s      1.5s              45.3%
      8     2175      1.9s      1.6s              45.2%
```

Wrong. The context grew 2.6x and the share fell after turn one, then sat flat at
about 45%. Turn one costs 5.1 GPU-seconds because nothing is cached yet. Every
turn after it costs about 3.4, and that figure does not grow as the transcript
does.

The reason is prefix caching. When a session grows by appending, each call
prefills only the new tokens and reuses the rest of the KV cache. So the obvious
mitigations, shorter sessions and more aggressive trimming, do not help here.

Note how little ground this covers. Eight turns took the transcript to 2,175
tokens, well short of the 8,192 the run was pinned to and shorter than the 5,000
token prompts in the ledger above. What I measured is that the share stays flat
over the first couple of thousand tokens.

## Compaction pays twice

If append-only growth is cheap because the cache holds, then the expensive thing
is invalidating the prefix, not reading a lot. To check that, I ran the same judge
call five times over an identical body of session state. In one arm the only text
that changed between calls sat at the end of the prompt. In the other, a random
nonce was pasted at the front as well.

```
#### OUTPUT ####
   rep   append-only prefill   rewritten-prefix prefill
  ------------------------------------------------------
     0                 1.71s                      1.88s
     1                 0.06s                      1.89s
     2                 0.06s                      1.83s
     3                 0.06s                      1.87s
     4                 0.06s                      1.84s

  median prefill after first call: append-only 0.06s   rewritten 1.87s
  penalty 30.9x
```

The session state and the work asked for are identical in both columns; the
second carries the nonce on top, about fifteen tokens. Appending lets prefill
collapse from 1.71s to 0.06s once the cache is warm. Prepending costs 1.87s on
every call for the life of the session.

<figure>
<svg viewBox="0 0 700 220" role="img" aria-label="Prefill time per repetition for append-only versus rewritten prefix" style="width:100%;height:auto">
  <text x="0" y="16" fill="var(--ink)" font-size="13" font-weight="600">prefill per call (s), five identical repetitions</text>
  <line x1="60" y1="170" x2="660" y2="170" stroke="var(--line)"/>
  <line x1="60" y1="40" x2="60" y2="170" stroke="var(--line)"/>
  <g font-size="11" fill="var(--ink-soft)">
    <text x="52" y="174" text-anchor="end">0</text>
    <text x="52" y="107" text-anchor="end">1.0</text>
    <text x="52" y="44" text-anchor="end">2.0</text>
  </g>
  <g font-size="11" fill="var(--ink-soft)">
    <text x="140" y="190" text-anchor="middle">1</text>
    <text x="260" y="190" text-anchor="middle">2</text>
    <text x="380" y="190" text-anchor="middle">3</text>
    <text x="500" y="190" text-anchor="middle">4</text>
    <text x="620" y="190" text-anchor="middle">5</text>
    <text x="360" y="210" text-anchor="middle">repetition</text>
  </g>
  <polyline points="140,59 260,66 380,51 500,48 620,50" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
  <polyline points="140,59 260,166 380,166 500,166 620,166" fill="none" stroke="var(--ink-soft)" stroke-width="2" stroke-dasharray="5 4"/>
  <g fill="var(--accent)"><circle cx="140" cy="59" r="4"/><circle cx="260" cy="66" r="4"/><circle cx="380" cy="51" r="4"/><circle cx="500" cy="48" r="4"/><circle cx="620" cy="50" r="4"/></g>
  <g fill="var(--ink-soft)"><circle cx="140" cy="59" r="3.5"/><circle cx="260" cy="166" r="3.5"/><circle cx="380" cy="166" r="3.5"/><circle cx="500" cy="166" r="3.5"/><circle cx="620" cy="166" r="3.5"/></g>
  <text x="640" y="40" fill="var(--accent)" font-size="11" text-anchor="end" font-weight="600">prefix rewritten</text>
  <text x="648" y="158" fill="var(--ink-soft)" font-size="11" text-anchor="end">append-only, cache holds</text>
</svg>
<figcaption>The only difference between the two lines is where a few tokens were inserted.</figcaption>
</figure>

A lot of ordinary agent code sits on the wrong side of that line. Compaction
that rewrites the transcript buys memory and forfeits the cache for every later
call, which is why it pays twice. Retrieved documents placed at the top of the
prompt, the default layout in most RAG code, change every turn and guarantee the
cache never hits. Anything rotating in the system prompt, a timestamp or a
session ID, costs the entire prefix for the sake of a few tokens.

## Batching hides the harness until the box saturates

The first version of this measurement ran with `OLLAMA_NUM_PARALLEL` unset, so
the box was serialising instead of batching. Rerunning the concurrency sweep at 1
and at 4 says how much of the penalty was queueing. The two settings are separate
runs in the raw log, so unlike every other table here this one is merged by hand
and the tail column is renamed:

```
#### E4, BOTH RUNS, MERGED BY HAND ####
  concurrent  harness   parallel=1  parallel=4   slow p1   slow p4
  ------------------------------------------------------------------
           1    False        16.17       17.89       3.6       3.3
           1     True         6.00        7.28      10.0       8.7
           2    False        14.70       18.66       8.4       7.0
           2     True        10.15       12.94      11.9       9.5
           4    False        16.31       20.24      12.5      11.8
           4     True        11.03       17.18      21.5      14.0
           8    False        18.02       27.26      24.2      17.6
           8     True        10.62       11.49      45.0      41.8
```

Batching works, up to a point. At four concurrent sessions it lifts the harnessed
path from 11.03 to 17.18 sessions per minute and the penalty against an
unharnessed box nearly disappears, from 1.48x down to 1.18x. At eight sessions the
unharnessed path keeps scaling to 27.26 while the harnessed path falls back to
11.49, the penalty reopens to 2.37x, and the slow tail sits at 41.8s.

Two caveats on that table. Every cell is a single run of four sessions, eight at
the top step, with no repeats, so the flat no-harness line at parallel=1 (16.17,
14.70, 16.31, 18.02) is inside the noise and is not a trend. And the last two
columns are the second-slowest session in each run, which is all a sample that
size supports. They are not a p95, whatever my harness called them.

<figure>
<svg viewBox="0 0 700 300" role="img" aria-label="Sessions per minute against concurrency for four configurations" style="width:100%;height:auto">
  <text x="0" y="16" fill="var(--ink)" font-size="13" font-weight="600">sessions per minute</text>
  <line x1="60" y1="245" x2="660" y2="245" stroke="var(--line)"/>
  <line x1="60" y1="40" x2="60" y2="245" stroke="var(--line)"/>
  <g font-size="11" fill="var(--ink-soft)">
    <text x="52" y="249" text-anchor="end">0</text>
    <text x="52" y="181" text-anchor="end">10</text>
    <text x="52" y="113" text-anchor="end">20</text>
    <text x="52" y="45" text-anchor="end">30</text>
    <text x="130" y="266" text-anchor="middle">1</text>
    <text x="300" y="266" text-anchor="middle">2</text>
    <text x="470" y="266" text-anchor="middle">4</text>
    <text x="640" y="266" text-anchor="middle">8</text>
    <text x="360" y="286" text-anchor="middle">concurrent sessions</text>
  </g>
  <polyline points="130,123 300,118 470,107 640,60" fill="none" stroke="var(--ink-soft)" stroke-width="2"/>
  <polyline points="130,135 300,145 470,134 640,122" fill="none" stroke="var(--ink-soft)" stroke-width="2" stroke-dasharray="5 4"/>
  <polyline points="130,196 300,157 470,128 640,167" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
  <polyline points="130,204 300,176 470,170 640,173" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 4"/>
  <g fill="var(--ink-soft)"><circle cx="130" cy="123" r="3.5"/><circle cx="300" cy="118" r="3.5"/><circle cx="470" cy="107" r="3.5"/><circle cx="640" cy="60" r="3.5"/></g>
  <g fill="var(--accent)"><circle cx="130" cy="196" r="4"/><circle cx="300" cy="157" r="4"/><circle cx="470" cy="128" r="4"/><circle cx="640" cy="167" r="4"/></g>
  <text x="628" y="52" fill="var(--ink-soft)" font-size="11" text-anchor="end">no harness, batching on</text>
  <text x="470" y="118" fill="var(--accent)" font-size="11" text-anchor="middle" font-weight="600">harness, batching on</text>
  <text x="652" y="190" fill="var(--ink-soft)" font-size="11" text-anchor="end">dashed: batching off</text>
</svg>
<figcaption>The harnessed path tracks the clean one to four sessions, then falls back while the clean one keeps going.</figcaption>
</figure>

So the harness costs headroom, not a fixed fraction of the box. It lowers the
concurrency at which the machine stops scaling, so a capacity number measured
with the guardrails switched off will be higher than the one you can operate at.

## Does the ledger predict anything?

The whole argument rests on GPU-seconds being the number worth keeping, so it is
fair to ask whether it forecasts anything. It does, and the table above is the
check.

The ledger for `qwen3:4b` puts overhead at 1.46x the functional work, so a
harnessed session should cost 2.46 times an unharnessed one, and a box running
them one at a time should turn over 2.46x fewer. Measured at
`OLLAMA_NUM_PARALLEL=4`, concurrency 1: 17.89 against 7.28, a ratio of 2.46. With
batching off it came out at 2.70, and at eight concurrent sessions 2.37.

Run the same prediction from the output-token column and you get 1 + 0.58 = 1.58x
against the same measured 2.46, an undershoot of about a third on the throughput
you give up.

One honest limit on that comparison. Both predictions are single-session
accounting, so the serial column is the only place either of them claims to
forecast anything, and away from it neither does. The eight cells of the batching
sweep give penalties of 2.70, 1.45, 1.48 and 1.70 with batching off, and 2.46,
1.44, 1.18 and 2.37 with it on. At concurrency 2 and 4 the penalty collapses to
between 1.18x and 1.48x, and the 1.58x token figure lands nearer to those than the
ledger's 2.46x does. That is not the token column working. It is a smaller wrong
number sitting near a region where the penalty is set by how much queue the
batcher can absorb rather than by any per-session ledger.

Four sessions per cell does not earn a match as close as 2.46 against 2.46, and
the workload mix is not quite identical between the two experiments, so the third
significant figure is luck. What the ledger buys is the serial number, and that is
the one that sets a floor under capacity.

## Resident memory is weights plus a reservation you chose

The first run of this experiment produced an oddity I could not explain: a model
whose weights are about 2.5 GB on disk sat at 22 GB resident. Varying `num_ctx`
explains it. Resident figures here are what Ollama reports through `/api/ps`, in
decimal GB, and the sweep ran with four parallel slots.

```
#### OUTPUT ####
  model               num_ctx   resident   over weights
  ------------------------------------------------------
  qwen3:4b               2048      3.9GB          1.4GB
  qwen3:4b               8192      7.5GB          5.0GB
  qwen3:4b              32768     22.0GB         19.5GB
  qwen3:4b             131072     80.6GB         78.1GB
```

The KV reservation is linear in context length and it dwarfs the weights well
before you reach the default. It is also per parallel slot, so the `num_ctx`
column above is really four times that many tokens of reservation: 32,768 across
four slots produced the same 22 GB that 131,072 on a single slot produced in the
earlier run, which is where the original oddity came from. By the last row this
2.5 GB model is asking for 80.6 GB on a machine with 36, a number Ollama will
report and the hardware cannot honour.

Those four rows look like they say resident memory is set by the context window
and not by the parameter count. I believed that until I ran the next model.

## The 35B with more room for context than the 4B

Running the same sweep on the mixture-of-experts model inverts the conclusion.

```
#### OUTPUT ####
  model               num_ctx   resident   over weights
  ------------------------------------------------------
  qwen3.5:35b-a3b        2048     23.1GB          0.1GB
  qwen3.5:35b-a3b        8192     23.3GB          0.3GB
  qwen3.5:35b-a3b       32768     23.8GB          0.8GB
```

Going from 2,048 to 32,768 tokens costs the dense 4B model 18.1 GB and costs the
35B model 0.7 GB. That is 30,720 extra tokens of `num_ctx` across four slots, so
per thousand tokens of `num_ctx` the 4B pays 589 MB and the 35B pays 23 MB, a
factor of 26.

The generalisation is duller than either sweep suggests: resident memory is
weights plus a KV reservation, and which term dominates depends on the model's
attention geometry and on a context setting you chose. The consequence is more
surprising. On this 36 GB box the 35B model can hold a longer context than the 4B
one. If your instinct is that a smaller model leaves more room for context, that
instinct is backwards for a large class of current models. I only measured the
35B out to 32,768, so the size of the gap beyond that is extrapolation. The
ordering is not.

## Where these numbers stop being true

One machine, one serving runtime, one synthetic corpus, and a harness whose
shape I chose. Each of those bounds the result, and it is worth being specific
about which way each one cuts.

A server built for throughput, as against a laptop daemon, would push the
saturation point in the batching section further right, though the shape of the
curve should hold, because what saturates is memory bandwidth against reserved
KV. A production agent with longer tool outputs and shorter judged answers would
move the overhead share up, not down, since every one of those changes adds
tokens to be read and not written. Both of the shortcuts I declared at the top
cut the same way: feeding the judge and the outbound guard the real answer, and
handing compaction a transcript that carries the plan and the answer rather than
just the question and the documents, would each move the share up. The
prefix-cache result is the most portable of the set, because it depends on a
property every serving runtime with a KV cache shares, and the least portable is
the exact 59% figure, which is a property of the harness I wrote.

If you want the number that applies to your system, copy the method and not the
harness. Tag each call as functional or overhead, charge it for prefill and
decode, then read the ledger. If you are instrumenting with OpenTelemetry, the
attribute set Biswas proposes already carries `input_tokens`, `output_tokens` and
`cost` for every model invocation, which is three fields that cannot answer this
question on hardware you own. Two more, prefill and decode duration, would make
occupancy computable on a box where `cost` is zero.

## What it cost to find out

```
#### OUTPUT ####
  item                                          value
  --------------------------------------------------------
  hardware                        Apple M3 Max, 36 GB
  models downloaded                           30.2 GB
  model invocations                         about 450
  experiments                                       5
  wall clock, measurement runs                12m 40s
  daemon restarts, to vary NUM_PARALLEL             2
  hypotheses written down in advance                2
  hypotheses that survived                          0
```

Neither prediction survived. The overhead share did not climb with session
length, and resident memory is not governed by the context window in the way four
convincing rows suggested. Adding a model corrected both. Thinking harder about
the ones I already had would not have.

## What I would cut first

I set out to check whether an agent harness is worth what it costs when nobody is
billing you per token. On four models it took between 52.8% and 61.4% of the GPU,
and on every one of them the output-token column pointed the other way while the
input-token column overshot.

The routing fix people reach for first does not work. Sending the overhead to a
smaller model looks appealing until you notice that `qwen3:1.7b` carries
essentially the same overhead share as the 4B, 59.1% against 59.3%, so the shape
of the problem is unchanged, and that a second resident model costs its full
weights out of a memory budget you have already spent.

The measurements point at prefill instead, because that is where the overhead
sits.

- Keep the context append-only. Prepending anything costs 31x on every
  subsequent call, the largest single number in this post.
- Move retrieved documents below the stable part of the prompt, not above it, so
  the cache survives a change in retrieval results.
- Keep the guardrails off the transcript. Mine only ever saw the question, and
  they were the two cheapest rows in the ledger at 2.9% and 2.8%. I never ran the
  expensive version, so take this as what the ledger implies and not as something
  I measured.
- Judge on a sample. The judge wrote at most 16 tokens a call and took 23.3% of
  the box.
- Size capacity with the harness switched on, since it costs headroom and not a
  fixed percentage.

Both wrong predictions came from the same mistake. I counted model invocations as
units of work, when the box is charging for tokens read and memory reserved. So
count what your agent re-reads, and check what your serving runtime has reserved
on your behalf.

The harness is [466 lines of standard library](/assets/code/agent-capacity-harness.py)
and needs a running Ollama daemon and the four models pulled; the
[full output of every run is here](/assets/code/agent-capacity-results.txt).