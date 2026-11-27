---
title: "Stopping AI agents from skipping steps, with one file that runs anywhere"
description: "Stepgate is an MCP server that shows an agent one step at a time and moves on only when mechanical checks pass, so it cannot skip a step or fake a result. A stepfile is one portable file that runs in any MCP client. Measuring its checks showed most of them were doing work the model should never have been doing."
tags: [ai, agents, mcp, guardrails]
---
An AI agent given a procedure as text decides how much of it to follow. It drops
a step, calls the task done, and leaves no record of what it ran. In τ²-bench's
single-control domains, a claimed success the environment does not show accounts
for 45% to 48% of failures, and no LLM judge in that study scored above 0.65
AUROC at catching it ([Advani, 2026](https://arxiv.org/abs/2606.09863)). Another
study found that 27% to 78% of the successes benchmarks report hide a procedural
violation ([Cao, Driouich and Thomas, 2026](https://arxiv.org/abs/2603.03116)).

[Stepgate](https://github.com/Chaarangan/stepgate) is the MCP server I built to
stop that, and the name is the design: a gate at every step. The procedure is a
YAML stepfile. When it runs, Stepgate shows the client's agent only the current
step, makes every API call itself, and moves on only when that step's gates
pass. The agent cannot skip ahead, because it is not told the next step exists
until the current one passes, and it cannot declare a step done, because a step
passes only when its gates pass over what it submitted.

A gate is a mechanical check (JSON Schema, a JSONLogic rule, an HTTP verifier,
or a person's approval) and never a model's opinion. Because Stepgate makes the
calls, a gate can compare what the model submitted with what the API returned,
which is how a fabricated value gets caught. That makes the path through a
procedure deterministic, within limits worth being exact about. Given the same
inputs, the same submissions and the same API responses, a run takes the same
path: the steps run in the same order, and every gate gives the same verdict.
What the model submits still varies, and so does anything a person approves.

<figure>
<svg viewBox="0 0 700 480" role="img" aria-label="How a Stepgate run works: the agent sees one step, Stepgate makes every API call, and gates decide when to move on" aria-labelledby="stepgate-run-title stepgate-run-desc" style="width:100%;height:auto">
  <title id="stepgate-run-title">How a Stepgate run works</title>
  <desc id="stepgate-run-desc">Sequence diagram: the client's agent starts a run and is shown only step 1, calls an operation through Stepgate, which adds the credential and calls the API, then submits the step's output; Stepgate's gates either return a diagnosis for a retry or show step 2.</desc>
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="var(--ink-soft)"/></marker>
    <marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="var(--accent)"/></marker>
  </defs>
  <rect width="700" height="480" fill="var(--bg)"/>
  <line x1="100" y1="56" x2="100" y2="428" stroke="var(--line)" stroke-width="1" stroke-dasharray="3,3"/>
  <line x1="352" y1="56" x2="352" y2="428" stroke="var(--line)" stroke-width="1" stroke-dasharray="3,3"/>
  <line x1="600" y1="56" x2="600" y2="428" stroke="var(--line)" stroke-width="1" stroke-dasharray="3,3"/>
  <rect x="84" y="336" width="296" height="92" rx="4" fill="var(--line-soft)" stroke="var(--line)" stroke-width="1"/>
  <rect x="84" y="336" width="40" height="16" rx="2" fill="var(--bg)" stroke="var(--line)" stroke-width="1"/>
  <text x="104" y="348" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.12em">ALT</text>
  <text x="132" y="348" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">[a gate fails]</text>
  <line x1="92" y1="384" x2="372" y2="384" stroke="var(--line)" stroke-width="1" stroke-dasharray="4,3"/>
  <text x="96" y="400" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">[every gate passes]</text>
  <line x1="108" y1="88" x2="344" y2="88" stroke="var(--ink-soft)" stroke-width="1.2" marker-end="url(#arrow)"/><rect x="168" y="70" width="116" height="12" fill="var(--bg)"/><text x="226" y="79" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.06em">START RUN (INPUTS)</text>
  <line x1="344" y1="120" x2="108" y2="120" stroke="var(--ink-soft)" stroke-width="1.2" stroke-dasharray="5,4" marker-end="url(#arrow)"/><rect x="189" y="102" width="74" height="12" fill="var(--bg)"/><text x="226" y="111" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.06em">STEP 1 ONLY</text>
  <line x1="108" y1="160" x2="344" y2="160" stroke="var(--ink-soft)" stroke-width="1.2" marker-end="url(#arrow)"/><rect x="183" y="142" width="86" height="12" fill="var(--bg)"/><text x="226" y="151" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.06em">STEPGATE_CALL</text>
  <line x1="360" y1="192" x2="592" y2="192" stroke="var(--ink-soft)" stroke-width="1.2" marker-end="url(#arrow)"/><rect x="433" y="174" width="86" height="12" fill="var(--bg)"/><text x="476" y="183" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.06em">REQUEST + KEY</text>
  <line x1="592" y1="224" x2="360" y2="224" stroke="var(--ink-soft)" stroke-width="1.2" stroke-dasharray="5,4" marker-end="url(#arrow)"/><rect x="433" y="206" width="86" height="12" fill="var(--bg)"/><text x="476" y="215" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.06em">FULL RESPONSE</text>
  <line x1="344" y1="256" x2="108" y2="256" stroke="var(--ink-soft)" stroke-width="1.2" stroke-dasharray="5,4" marker-end="url(#arrow)"/><rect x="204" y="238" width="44" height="12" fill="var(--bg)"/><text x="226" y="247" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.06em">RESULT</text>
  <line x1="108" y1="288" x2="344" y2="288" stroke="var(--ink-soft)" stroke-width="1.2" marker-end="url(#arrow)"/><rect x="177" y="270" width="98" height="12" fill="var(--bg)"/><text x="226" y="279" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.06em">STEPGATE_SUBMIT</text>
  <path d="M 360 300 L 388 300 Q 396 300 396 308 L 396 312 Q 396 320 388 320 L 364 320" fill="none" stroke="var(--ink-soft)" stroke-width="1.2" marker-end="url(#arrow)"/>
  <rect x="404" y="303" width="64" height="12" fill="var(--bg)"/>
  <text x="408" y="312" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" letter-spacing="0.06em">RUN GATES</text>
  <line x1="344" y1="376" x2="108" y2="376" stroke="var(--ink-soft)" stroke-width="1.2" stroke-dasharray="5,4" marker-end="url(#arrow)"/><rect x="174" y="358" width="104" height="12" fill="var(--bg)"/><text x="226" y="367" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.06em">DIAGNOSIS, RETRY</text>
  <line x1="344" y1="420" x2="108" y2="420" stroke="var(--accent)" stroke-width="1.2" marker-end="url(#arrow-accent)"/><rect x="204" y="402" width="44" height="12" fill="var(--bg)"/><text x="226" y="411" fill="var(--accent-ink)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.06em">STEP 2</text>
  <rect x="20" y="16" width="160" height="40" rx="6" fill="var(--bg)" stroke="var(--ink)" stroke-width="1"/>
  <text x="100" y="36" fill="var(--ink)" font-size="12" font-weight="600" text-anchor="middle">Agent</text>
  <text x="100" y="50" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle">IN YOUR MCP CLIENT</text>
  <rect x="272" y="16" width="160" height="40" rx="6" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1"/>
  <text x="352" y="36" fill="var(--ink)" font-size="12" font-weight="600" text-anchor="middle">Stepgate</text>
  <text x="352" y="50" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle">HOLDS KEYS, RUNS GATES</text>
  <rect x="520" y="16" width="160" height="40" rx="6" fill="var(--line-soft)" stroke="var(--ink-soft)" stroke-width="1"/>
  <text x="600" y="36" fill="var(--ink)" font-size="12" font-weight="600" text-anchor="middle">API</text>
  <text x="600" y="50" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle">DECLARED HOSTS ONLY</text>
  <line x1="20" y1="448" x2="680" y2="448" stroke="var(--line)" stroke-width="0.8"/>
  <line x1="20" y1="464" x2="52" y2="464" stroke="var(--ink-soft)" stroke-width="1.2" marker-end="url(#arrow)"/>
  <text x="60" y="467" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">CALL</text>
  <line x1="120" y1="464" x2="152" y2="464" stroke="var(--ink-soft)" stroke-width="1.2" stroke-dasharray="5,4" marker-end="url(#arrow)"/>
  <text x="160" y="467" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">REPLY</text>
</svg>
<figcaption>The agent never sees step 2 until step 1's gates pass, and never holds the API key.</figcaption>
</figure>

The second goal was portability. I wanted an agent I could hand to anyone: one
file, with no packages, runtime or versions to install, that runs in whatever AI
client the other person already uses, with the model they already pay for. MCP,
the Model Context Protocol that clients such as Claude Code and Cursor use to
call tools, makes that possible, because a server that speaks it plugs into all
of them. So the stepfile is the whole agent. It names no model, provider or
framework, calls only remote APIs, and declares the credentials it needs without
saying where they live, so whoever runs it supplies their own keys.

That is also what separates a stepfile from a workflow engine such as n8n. An
n8n workflow runs inside an n8n server, with the model and keys configured
there. A stepfile travels to the agent: anyone runs it with `npx -y stepgate` in
the client they already use, and its gates come with it.

Two more properties come from Stepgate making every call. The model never holds
an API key, because Stepgate attaches credentials itself and sends requests only
to the hosts the stepfile declares. And every run writes a hash-chained ledger
of each step, tool call, gate verdict and retry, so editing a record afterwards
breaks the chain, which `stepgate --verify` detects.

## Half of every stepfile was checking

Stepgate ships with a catalog of eighteen stepfiles: CVE triage, a 10-K ratio
extraction, a regulatory monitor, a Zendesk-to-Jira escalation and so on. I
wrote a script to count where their lines go, and the answer was uncomfortable:

```
#### THE CATALOG, AS FIRST WRITTEN ####
Lines, counted as block-style YAML: 16247
Share of lines: {"gates":"53%","produces":"15%","tools":"14%","instructions":"8%","other":"11%"}
Filters over calls by tool: 145
Predicates reading: {"calls":106,"steps_or_inputs":110,"output_only":45}
```

Gates were 53% of the catalog and instructions were 8%. The same filter ("the
successful results of this operation") was written out by hand 145 times, and
110 of the 261 predicate gates compared the output with the inputs or an earlier
step. Reading through them, most were not checking judgement. They checked that
the model had copied a value correctly, counted a list correctly, or done a sum
correctly.

The clearest case checks the vehicle on an insurance claim against its VIN. It
decodes the VIN with NHTSA's vPIC service and compares the claimed make and
model with the decode, ignoring letter case. The model did the comparison, and
a gate redid it by lowercasing both strings with a 26-branch `if`, one branch
per letter of the alphabet. Four agent steps and 372 lines, mostly proving that
the model could copy fields out of JSON and compare two strings.

That is backwards. A model is slow at copying and unreliable at arithmetic, and
each of those steps cost tokens, sometimes a retry, and a gate few people could
review. None of it needed judgement.

## The model judges, the server computes

A stepfile has two kinds of step. An agent step has instructions, and the model
does it. A mechanical step has `do` instead: Stepgate makes the listed calls,
with arguments built from the inputs and earlier outputs, and computes the
step's output from a template. The client never sees a mechanical step. The VIN
decode is one:

```yaml
- id: decode
  do:
    calls:
      - { id: decode, operation: decodeVin, arguments: { vin: { var: inputs.vin } } }
    output:
      make: { var: responses.decode.Results.0.Make }
      model: { var: responses.decode.Results.0.Model }
      model_year: { var: responses.decode.Results.0.ModelYear }
```

When only part of an agent step is a computation, such as a count, a derived
field covers it: Stepgate fills the field in after the model submits, so the
model is never asked for it and no gate has to check it.

The VIN stepfile is now four mechanical steps (decode, compare, recalls,
verdict) and one agent step, the summary for the claims handler, in 242 lines.
Against the live NHTSA APIs, the VIN decodes to a 2009 Toyota Prius with six
recalls, the claim says a 2010 Camry, and the verdict is `refer`, with no field
touched by the model. Its one job is the prose, and the gates on that prose
check it against those values. A summary citing a recall campaign that was never
returned is rejected by name.

<figure>
<svg viewBox="0 0 700 272" role="img" aria-label="The VIN stepfile before and after: four agent steps with 15 gates became four mechanical steps and one agent step with 3 gates" aria-labelledby="vin-steps-title vin-steps-desc" style="width:100%;height:auto">
  <title id="vin-steps-title">The VIN stepfile before and after</title>
  <desc id="vin-steps-desc">Before, the model did all four steps and 15 gates checked its copying and comparisons, in 372 lines; after, Stepgate does four steps itself and the model writes only the report, checked by 2 gates, in 242 lines.</desc>
  <rect width="700" height="272" fill="var(--bg)"/>
  <text x="20" y="24" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" letter-spacing="0.14em">BEFORE · 372 LINES · 15 GATES</text>
  <rect x="20" y="36" width="148" height="56" rx="6" fill="var(--bg)" stroke="var(--ink)" stroke-width="1"/><text x="94" y="62" fill="var(--ink)" font-size="12" font-weight="600" text-anchor="middle">decode</text><text x="94" y="78" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.04em">AGENT · 2 GATES</text><rect x="192" y="36" width="148" height="56" rx="6" fill="var(--bg)" stroke="var(--ink)" stroke-width="1"/><text x="266" y="62" fill="var(--ink)" font-size="12" font-weight="600" text-anchor="middle">compare</text><text x="266" y="78" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.04em">AGENT · 4 GATES</text><rect x="364" y="36" width="148" height="56" rx="6" fill="var(--bg)" stroke="var(--ink)" stroke-width="1"/><text x="438" y="62" fill="var(--ink)" font-size="12" font-weight="600" text-anchor="middle">recalls</text><text x="438" y="78" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.04em">AGENT · 4 GATES</text><rect x="536" y="36" width="148" height="56" rx="6" fill="var(--bg)" stroke="var(--ink)" stroke-width="1"/><text x="610" y="62" fill="var(--ink)" font-size="12" font-weight="600" text-anchor="middle">report</text><text x="610" y="78" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.04em">AGENT · 5 GATES</text>
  <text x="20" y="140" fill="var(--accent-ink)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" letter-spacing="0.14em">AFTER · 242 LINES · 3 GATES</text>
  <rect x="20" y="152" width="120" height="56" rx="6" fill="var(--line-soft)" stroke="var(--ink-soft)" stroke-width="1"/><text x="80" y="178" fill="var(--ink)" font-size="12" font-weight="600" text-anchor="middle">decode</text><text x="80" y="194" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.04em">STEPGATE · 1 GATE</text><rect x="156" y="152" width="120" height="56" rx="6" fill="var(--line-soft)" stroke="var(--ink-soft)" stroke-width="1"/><text x="216" y="178" fill="var(--ink)" font-size="12" font-weight="600" text-anchor="middle">compare</text><text x="216" y="194" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.04em">STEPGATE</text><rect x="292" y="152" width="120" height="56" rx="6" fill="var(--line-soft)" stroke="var(--ink-soft)" stroke-width="1"/><text x="352" y="178" fill="var(--ink)" font-size="12" font-weight="600" text-anchor="middle">recalls</text><text x="352" y="194" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.04em">STEPGATE</text><rect x="428" y="152" width="120" height="56" rx="6" fill="var(--line-soft)" stroke="var(--ink-soft)" stroke-width="1"/><text x="488" y="178" fill="var(--ink)" font-size="12" font-weight="600" text-anchor="middle">verdict</text><text x="488" y="194" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.04em">STEPGATE</text><rect x="564" y="152" width="120" height="56" rx="6" fill="var(--bg)" stroke="var(--ink)" stroke-width="1"/><text x="624" y="178" fill="var(--ink)" font-size="12" font-weight="600" text-anchor="middle">report</text><text x="624" y="194" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle" letter-spacing="0.04em">AGENT · 2 GATES</text>
  <line x1="20" y1="232" x2="680" y2="232" stroke="var(--line)" stroke-width="0.8"/>
  <rect x="20" y="244" width="16" height="12" rx="2" fill="var(--bg)" stroke="var(--ink)" stroke-width="1"/>
  <text x="44" y="253" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">AGENT STEP: THE MODEL WRITES THE OUTPUT</text>
  <rect x="340" y="244" width="16" height="12" rx="2" fill="var(--line-soft)" stroke="var(--ink-soft)" stroke-width="1"/>
  <text x="364" y="253" fill="var(--ink-soft)" font-size="8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">MECHANICAL STEP: STEPGATE DOES IT</text>
</svg>
<figcaption>Twelve of the fifteen gates checked work the model no longer does.</figcaption>
</figure>

The whole catalog works this way now:

```
#### THE CATALOG NOW ####
Lines, counted as block-style YAML: 12397
Share of lines: {"gates":"12%","mechanical":"30%","produces":"19%","tools":"18%","instructions":"4%","other":"17%"}
Filters over calls by tool: 2
```

This did more for determinism than any gate. A mechanical step returns the
same output for the same API responses every time, so each step moved out of
the model is one less place for a run to vary.

The files went from 8,547 lines to 6,321, and gates from 53% to 12%. I trust
that second number less than it looks, because much of the gate logic did not
disappear. It moved into the `do` templates, which are JSONLogic too, and gates
and templates together are still 42% of the catalog. The model does far less.
The stepfile is only somewhat easier to read.

## Writes wait for a person

Six of the stepfiles write something: a Jira issue, a Gmail draft, a monday.com
item, a note on a Zendesk ticket or a ServiceNow incident. Each follows the same
shape. An agent step drafts exactly what will be written, a person approves it,
and a mechanical step performs the write from the approved output. The write
step can read only inputs and earlier outputs, never a fresh API response, so
what reaches Jira is what the person saw.

The approval travels as an MCP elicitation, a form the client shows. Not every
client shows it. Testing from the Claude Code extension in VS Code, every
approval came back declined within a millisecond of the submission, which is not
a human reaction time: the extension declares the capability and then declines
without drawing the form ([#79174](https://github.com/anthropics/claude-code/issues/79174)).
The same test in a terminal session came back approved 5.8 seconds after the
submit. Stepgate cannot tell those two declines apart, so it reports only that
the approval was declined, and the docs name the clients that work.

## Where this stops being true

Running a stepfile still needs Node.js 22.18 or later wherever Stepgate itself
runs, so "no dependencies" is true of the file and not of the machine. Every
number here comes from one catalog of eighteen stepfiles that I wrote, so
the 53% says as much about how I wrote gates as about gates in general. The
eleven public-data stepfiles pass against their live APIs with qwen3.6-35b-a3b
through OpenRouter. The six that write were checked only against recorded
cases, because I do not have accounts on those services.

The bigger limit is JSONLogic. Inside a `map` or `filter`, an expression sees
only the current item, so anything that needs outer data turns into a `reduce`
carrying context or a `join` against a one-element list. Sorting and date
arithmetic are both awkward today. Those gaps are open as proposals in the
[issue tracker](https://github.com/Chaarangan/stepgate/issues), with the largest
being CEL expressions as strings beside JSONLogic. CEL's specification guarantees
that an expression terminates, which matters when the file is untrusted.

## Try it

Stepgate is on npm and the MCP Registry, and any MCP client can run it:

```sh
npx -y stepgate --list                 # the catalog
npx -y stepgate auto-claim-vin-validation
```

If you already have a procedure written down as a skill or a runbook,
`stepgate_outline` turns it into a skeleton stepfile, with each rule it states
("never", "must") listed as a gate still to write. The
[repository](https://github.com/Chaarangan/stepgate) has the format reference,
the catalog, and the script behind both measurement blocks.

Moving work out of the model also made the agent more portable. A step Stepgate
computes behaves the same whichever model the client runs, so the fewer steps a
model does, the less a stepfile's behaviour depends on where it lands. The path
through a stepfile and every step that needs no judgement are deterministic, as
long as the APIs return the same data. Only the judgement travels with the
model.

The 53% was my own doing, but I doubt the pattern is mine alone. Ask a model to
do mechanical work and you end up writing checks to catch it, and each of those
checks needs a retry budget and a reviewer who can read it. If I were reviewing
a team's agent design, the first question I would ask is which values the model
produces that code could compute. Every one of those is cheaper to move into
code than to guard. Most of mine should never have been the model's job.
