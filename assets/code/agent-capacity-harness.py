"""What an agent's non-functional calls cost on hardware you own.

Standard library only. Requires a running Ollama daemon.

    ollama pull qwen3:1.7b qwen3:4b gemma3:4b qwen3.5:35b-a3b
    OLLAMA_NUM_PARALLEL=4 ollama serve      # in another shell
    python3 harness2.py

Every model invocation is tagged either *functional* (the calls doing the user's
task) or *overhead* (the calls that make it safe, scored, and durable). Ollama
reports prefill and decode durations separately, so each call can be charged for
GPU occupancy rather than merely counted.

Context length is pinned with num_ctx so results are comparable across models
of very different sizes; the daemon default of 131072 would not fit a 23 GB model
on a 36 GB machine.

Experiments
    E1  per-model ledger          does the overhead share hold across families/sizes?
    E2  session growth            does the overhead share climb as a session ages?
    E3  prefix cache              what does rewriting the front of the context cost?
    E4  concurrency and batching  how much queue converts back into throughput?
"""

import json
import os
import random
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

HOST = os.environ.get("OLLAMA_HOST_URL", "http://localhost:11434")
SEED = 20260906
NUM_CTX = 8192
NS = 1_000_000_000

SMALL = "qwen3:1.7b"
BASE = "qwen3:4b"
RIVAL = "gemma3:4b"
BIG = "qwen3.5:35b-a3b"


def log(*a):
    print(*a, flush=True)


@dataclass
class Call:
    cls: str
    step: str
    model: str
    prompt_tokens: int
    output_tokens: int
    prefill_s: float
    decode_s: float
    load_s: float = 0.0

    @property
    def gpu_s(self) -> float:
        return self.prefill_s + self.decode_s


def generate(model: str, prompt: str, num_predict: int) -> dict:
    body = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "think": False,
        "options": {
            "num_predict": num_predict,
            "num_ctx": NUM_CTX,
            "temperature": 0,
            "seed": SEED,
        },
    }).encode()
    req = urllib.request.Request(
        f"{HOST}/api/generate", data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=1800) as resp:
        return json.loads(resp.read())


def call(cls: str, step: str, model: str, prompt: str, num_predict: int) -> Call:
    r = generate(model, prompt, num_predict)
    return Call(
        cls, step, model,
        r.get("prompt_eval_count", 0), r.get("eval_count", 0),
        r.get("prompt_eval_duration", 0) / NS, r.get("eval_duration", 0) / NS,
        r.get("load_duration", 0) / NS,
    )


def resident():
    with urllib.request.urlopen(f"{HOST}/api/ps", timeout=30) as resp:
        return [(m["name"], m["size"] / 1e9)
                for m in json.loads(resp.read()).get("models", [])]


def unload(model: str, wait_s: float = 60.0) -> None:
    """Evict a model and wait for it to actually leave memory.

    A 23 GB model will not load beside a resident one on a 36 GB machine, so
    this has to be synchronous rather than fire-and-forget.
    """
    body = json.dumps({"model": model, "keep_alive": 0}).encode()
    req = urllib.request.Request(
        f"{HOST}/api/generate", data=body, headers={"Content-Type": "application/json"}
    )
    try:
        urllib.request.urlopen(req, timeout=120).read()
    except urllib.error.URLError:
        pass

    deadline = time.time() + wait_s
    while time.time() < deadline:
        if model not in dict(resident()):
            return
        time.sleep(1.0)
    log(f"  [warn] {model} still resident after {wait_s:.0f}s")


def available(model: str) -> bool:
    try:
        generate(model, "hi", 1)
        return True
    except Exception as e:
        log(f"  [skip] {model}: {e}")
        return False


# ---------------------------------------------------------------- toy corpus

TOPICS = [
    "warehouse inventory reconciliation", "supplier onboarding checks",
    "returns processing exceptions", "cold chain temperature excursions",
    "customs paperwork mismatches", "carrier rate card disputes",
    "demurrage and detention claims", "hazardous goods labelling",
]


def build_corpus(rng):
    docs = []
    for i, topic in enumerate(TOPICS):
        lines = [f"Document {i}: {topic}."]
        for j in range(12):
            lines.append(
                f"Clause {i}.{j}: When {topic} exceeds the agreed threshold, the "
                f"responsible team files a variance within {rng.randint(2, 10)} "
                f"business days and notifies the "
                f"{rng.choice(['ops', 'finance', 'compliance'])} desk."
            )
        docs.append("\n".join(lines))
    return docs


QUESTIONS = [
    "Which teams must be notified when a variance is filed, and how quickly?",
    "Summarise the escalation path for threshold breaches across all documents.",
    "What is the shortest filing window mentioned, and in which document?",
    "Do any two documents disagree about who owns the notification step?",
    "List every desk named across the corpus and what triggers each one.",
    "What would a reviewer need to check to confirm a variance was filed correctly?",
]


# ------------------------------------------------------------------ ledgering

def ledger(calls, title="", show_steps=True):
    steps = {}
    for c in calls:
        s = steps.setdefault(c.step, {"cls": c.cls, "n": 0, "pt": 0, "ot": 0,
                                      "pre": 0.0, "dec": 0.0})
        s["n"] += 1
        s["pt"] += c.prompt_tokens
        s["ot"] += c.output_tokens
        s["pre"] += c.prefill_s
        s["dec"] += c.decode_s
    total = sum(c.gpu_s for c in calls) or 1.0

    if title:
        log(f"\n  {title}")
    if show_steps:
        log(f"  {'step':<11} {'class':<11} {'calls':>5} {'in tok':>7} {'out tok':>8} "
            f"{'prefill':>8} {'decode':>7} {'gpu s':>7} {'% gpu':>6}")
        log("  " + "-" * 78)
        for step, s in sorted(steps.items(), key=lambda kv: -(kv[1]["pre"] + kv[1]["dec"])):
            g = s["pre"] + s["dec"]
            log(f"  {step:<11} {s['cls']:<11} {s['n']:>5} {s['pt']:>7} {s['ot']:>8} "
                f"{s['pre']:>7.1f}s {s['dec']:>6.1f}s {g:>6.1f}s {100 * g / total:>5.1f}%")

    f = [c for c in calls if c.cls == "functional"]
    o = [c for c in calls if c.cls == "overhead"]
    if not (f and o):
        return None
    r = {
        "calls": len(o) / len(f),
        "in": sum(c.prompt_tokens for c in o) / max(1, sum(c.prompt_tokens for c in f)),
        "out": sum(c.output_tokens for c in o) / max(1, sum(c.output_tokens for c in f)),
        "gpu": sum(c.gpu_s for c in o) / max(1e-9, sum(c.gpu_s for c in f)),
        "overhead_share": 100 * sum(c.gpu_s for c in o) / total,
        "prefill_share": 100 * sum(c.prefill_s for c in calls) / total,
    }
    log(f"\n  overhead:functional  calls {r['calls']:.2f}x  in-tok {r['in']:.2f}x  "
        f"out-tok {r['out']:.2f}x  gpu {r['gpu']:.2f}x   "
        f"overhead = {r['overhead_share']:.1f}% of gpu")
    return r


# ------------------------------------------------------------------- session

def run_session(idx, corpus, harness, model, overhead_model=None):
    om = overhead_model or model
    q = QUESTIONS[idx % len(QUESTIONS)]
    ctx = "\n\n".join(corpus[: 3 + (idx % 3)])
    calls = []

    if harness:
        calls.append(call("overhead", "guard_in", om,
                          f"Classify this request as ALLOW or BLOCK for policy "
                          f"violations. Answer with one word.\n\nRequest: {q}", 16))

    calls.append(call("functional", "plan", model,
                      f"Break this question into at most three retrieval steps. "
                      f"Be terse.\n\nQuestion: {q}", 64))

    ans = call("functional", "answer", model,
               f"Answer the question using only the documents below.\n\n"
               f"Documents:\n{ctx}\n\nQuestion: {q}", 128)
    calls.append(ans)

    if harness:
        transcript = f"Question: {q}\n\nDocuments:\n{ctx}"
        calls.append(call("overhead", "compact", om,
                          f"Compress the following session state into durable notes "
                          f"of at most three sentences.\n\n{transcript}", 64))
        calls.append(call("overhead", "judge", om,
                          f"Score the answer for groundedness from 1 to 5. Reply "
                          f"with the number only.\n\n{transcript}\n\nAnswer under "
                          f"review: (answer of {ans.output_tokens} tokens)", 16))
        calls.append(call("overhead", "guard_out", om,
                          f"Does this answer leak information absent from the "
                          f"documents? Reply ALLOW or BLOCK.\n\nAnswer: (answer of "
                          f"{ans.output_tokens} tokens)", 16))
    return calls


# ------------------------------------------------------- E1 per-model ledger

def e1_models(corpus, models):
    log("\n" + "=" * 82)
    log("E1  per-model ledger: does the overhead share survive a change of model?")
    log("=" * 82)
    log(f"\n  num_ctx pinned to {NUM_CTX} for every model.")
    rows = []
    for m in models:
        log(f"\n  --- {m} ---")
        if not available(m):
            continue
        res = dict(resident())
        calls = []
        for i in range(3):
            calls += run_session(i, corpus, True, m)
        r = ledger(calls, title=f"{m}", show_steps=True)
        if r:
            r["model"] = m
            r["resident_gb"] = res.get(m, float("nan"))
            r["decode_tps"] = (sum(c.output_tokens for c in calls) /
                               max(1e-9, sum(c.decode_s for c in calls)))
            rows.append(r)
        unload(m)

    log("\n#### OUTPUT ####")
    log(f"  {'model':<18} {'resident':>9} {'decode':>10} {'out-tok':>8} {'gpu':>7} "
        f"{'overhead % of gpu':>18}")
    log("  " + "-" * 76)
    for r in rows:
        log(f"  {r['model']:<18} {r['resident_gb']:>7.1f}GB {r['decode_tps']:>7.0f}t/s "
            f"{r['out']:>7.2f}x {r['gpu']:>6.2f}x {r['overhead_share']:>17.1f}%")
    return rows


# --------------------------------------------------------- E2 session growth

def e2_growth(corpus, model, turns=8):
    log("\n" + "=" * 82)
    log("E2  session growth: the overhead share as the transcript gets longer")
    log("=" * 82)
    if not available(model):
        return []
    q = QUESTIONS[0]
    transcript = "\n\n".join(corpus[:2])
    rows = []
    log("\n#### OUTPUT ####")
    log(f"  {'turn':>5} {'ctx tok':>8} {'func gpu':>9} {'over gpu':>9} "
        f"{'overhead % of gpu':>18}")
    log("  " + "-" * 54)
    for t in range(1, turns + 1):
        ans = call("functional", "answer", model,
                   f"Answer using only the session below.\n\n{transcript}\n\n"
                   f"Question: {q}", 96)
        plan = call("functional", "plan", model,
                    f"Name the next retrieval step. Be terse.\n\nQuestion: {q}", 32)
        judge = call("overhead", "judge", model,
                     f"Score the answer for groundedness from 1 to 5. Reply with the "
                     f"number only.\n\n{transcript}\n\nAnswer under review: "
                     f"(answer of {ans.output_tokens} tokens)", 16)
        compact = call("overhead", "compact", model,
                       f"Compress this session into durable notes of at most three "
                       f"sentences.\n\n{transcript}", 64)
        fg = ans.gpu_s + plan.gpu_s
        og = judge.gpu_s + compact.gpu_s
        rows.append({"turn": t, "ctx": ans.prompt_tokens, "f": fg, "o": og,
                     "share": 100 * og / (fg + og)})
        log(f"  {t:>5} {ans.prompt_tokens:>8} {fg:>8.1f}s {og:>8.1f}s "
            f"{100 * og / (fg + og):>17.1f}%")
        # the transcript grows the way a real session does: append, never shrink
        transcript += (f"\n\nTurn {t} answer: (an answer of {ans.output_tokens} "
                       f"tokens)\n" + "\n".join(corpus[2 + t % 5].splitlines()[:6]))
        if ans.prompt_tokens > NUM_CTX * 0.75:
            log("  (stopping: transcript approaching num_ctx)")
            break
    unload(model)
    return rows


# ----------------------------------------------------------- E3 prefix cache

def e3_prefix_cache(corpus, model, reps=5):
    log("\n" + "=" * 82)
    log("E3  prefix cache: what compaction costs by rewriting the front of context")
    log("=" * 82)
    if not available(model):
        return {}
    body = "\n\n".join(corpus[:4])
    stable, volatile = [], []

    for i in range(reps):
        c = call("overhead", "judge", model,
                 f"Session state:\n{body}\n\nScore the answer for groundedness "
                 f"from 1 to 5. Reply with the number only. Query {i}.", 8)
        stable.append(c.prefill_s)

    for i in range(reps):
        nonce = f"[session note {random.random():.17f}]\n"
        c = call("overhead", "judge", model,
                 f"{nonce}Session state:\n{body}\n\nScore the answer for "
                 f"groundedness from 1 to 5. Reply with the number only. Query {i}.", 8)
        volatile.append(c.prefill_s)

    log("\n#### OUTPUT ####")
    log(f"  {'rep':>4} {'append-only prefill':>21} {'rewritten-prefix prefill':>26}")
    log("  " + "-" * 54)
    for i in range(reps):
        log(f"  {i:>4} {stable[i]:>20.2f}s {volatile[i]:>25.2f}s")
    s_after = statistics.median(stable[1:]) if len(stable) > 1 else stable[0]
    v_med = statistics.median(volatile)
    log(f"\n  median prefill after first call: append-only {s_after:.2f}s   "
        f"rewritten {v_med:.2f}s   penalty {v_med / max(1e-9, s_after):.1f}x")
    unload(model)
    return {"stable": s_after, "volatile": v_med,
            "penalty": v_med / max(1e-9, s_after)}


# --------------------------------------------------- E4 concurrency/batching

def sweep(corpus, concurrency, harness, model, n_sessions):
    def one(i):
        t0 = time.perf_counter()
        run_session(i, corpus, harness, model)
        return time.perf_counter() - t0

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        lat = list(pool.map(one, range(n_sessions)))
    wall = time.perf_counter() - t0
    lat.sort()
    return {"sess_min": 60 * n_sessions / wall,
            "p95": lat[max(0, int(0.95 * len(lat)) - 1)],
            "median": statistics.median(lat)}


def e4_concurrency(corpus, model):
    par = os.environ.get("OLLAMA_NUM_PARALLEL", "unset")
    log("\n" + "=" * 82)
    log(f"E4  concurrency, OLLAMA_NUM_PARALLEL={par}")
    log("=" * 82)
    if not available(model):
        return []
    rows = []
    log("\n#### OUTPUT ####")
    log(f"  {'concurrent':>10} {'harness':>8} {'sess/min':>9} {'p95 s':>8} {'median s':>9}")
    log("  " + "-" * 48)
    for c in (1, 2, 4, 8):
        for h in (False, True):
            r = sweep(corpus, c, h, model, n_sessions=max(4, c))
            r.update({"c": c, "harness": h, "parallel": par})
            rows.append(r)
            log(f"  {c:>10} {str(h):>8} {r['sess_min']:>9.2f} {r['p95']:>8.1f} "
                f"{r['median']:>9.1f}")
    return rows


def e5_context_memory(models_ctx):
    """Resident memory as num_ctx varies: which term dominates, weights or KV?"""
    global NUM_CTX
    log("\n" + "=" * 82)
    log("E5  resident memory against context window")
    log("=" * 82)
    saved = NUM_CTX
    rows = []
    log("\n#### OUTPUT ####")
    log(f"  {'model':<18} {'num_ctx':>8} {'resident':>10} {'over weights':>14}")
    log("  " + "-" * 54)
    for model, ctxs, disk_gb in models_ctx:
        for ctx in ctxs:
            NUM_CTX = ctx
            unload(model)
            try:
                generate(model, "hi", 1)
            except Exception as e:
                log(f"  {model:<18} {ctx:>8}  failed: {str(e)[:40]}")
                continue
            gb = dict(resident()).get(model, float("nan"))
            rows.append({"model": model, "ctx": ctx, "gb": gb, "disk": disk_gb})
            log(f"  {model:<18} {ctx:>8} {gb:>8.1f}GB {gb - disk_gb:>12.1f}GB")
        unload(model)
    NUM_CTX = saved
    return rows


def main():
    rng = random.Random(SEED)
    random.seed(SEED)
    corpus = build_corpus(rng)
    only = sys.argv[1] if len(sys.argv) > 1 else "all"

    log(f"host={HOST}  num_ctx={NUM_CTX}  "
        f"OLLAMA_NUM_PARALLEL={os.environ.get('OLLAMA_NUM_PARALLEL', 'unset')}")

    out = {}
    if only in ("all", "e1"):
        out["e1"] = e1_models(corpus, [SMALL, BASE, RIVAL, BIG])
    if only in ("all", "e2"):
        out["e2"] = e2_growth(corpus, BASE)
    if only in ("all", "e3"):
        out["e3"] = e3_prefix_cache(corpus, BASE)
    if only in ("all", "e4"):
        out["e4"] = e4_concurrency(corpus, BASE)
    if only in ("all", "e5"):
        out["e5"] = e5_context_memory([
            (BASE, [2048, 8192, 32768, 131072], 2.5),
            (BIG, [2048, 8192, 32768], 23.0),
        ])

    tag = os.environ.get("RUN_TAG", "run")
    with open(f"results_{tag}.json", "w") as fh:
        json.dump(out, fh, indent=2, default=str)
    log(f"\nwrote results_{tag}.json")


if __name__ == "__main__":
    main()
