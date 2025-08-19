# Benchmarking & LLM Provider Evaluation

This guide describes how to assess chatbot quality, latency, and cost across providers/models for Coach Up.

Stack context: Next.js (App Router) + Convex + Clerk + FastAPI/LangChain; streaming via SSE/Web Streams.

## 1) Goals & Dimensions

- Quality: usefulness/correctness of feedback, instruction-following, clarity.
- Latency: time-to-first-token (TTFT), full-turn latency, tokens/sec.
- Cost: tokens in/out, $/turn, $/DAU; background vs realtime.
- Robustness: error/timeout rate, retries, fallback success.
- Safety: refusal rate, toxicity/PII leakage.

## 2) Datasets (Golden Set)

Start with 150–300 items across tasks:
- Micro-corrections (grammar/word choice) with short prompts and expected minimal rewrites.
- Coaching (assertiveness) with before/after examples.
- Multi-turn snippets (3–6 turns) for multi_turn scoring.
- Session summaries with 2–3 key points and next steps.

Schema (JSONL)
```json
{
  "id": "ex_001",
  "task": "micro_correction|assertiveness|word_choice|summary|multi_turn",
  "focusId": "focus_assertiveness",
  "rubricVersion": "v1",
  "input": {
    "messages": [
      {"role": "user", "content": "i go to store yesterday"}
    ]
  },
  "notes": "Expect minimal edit; keep tone."
}
```

Guidelines
- Mix synthetic and de-identified real data; avoid PII.
- Keep inputs short to control cost and reduce confounding factors.
- Version datasets (dataset.v1.jsonl, dataset.v2.jsonl).

## 3) Judge & Heuristics

Heuristic checks
- Minimality: Levenshtein distance vs input; ratio of changed tokens.
- Grammar/style: LanguageTool or similar; hedge-word delta for assertiveness.
- Structure: matches requested format (e.g., no extra commentary for rewrite-only tasks).

LLM-as-judge (pairwise)
- Calibrated judge prompt with explicit rubric. Run A vs B; 3 independent judge seeds → majority vote.
- Store judge decisions with confidence and rationale; sample 10–20% for human validation.

Judge record (JSON)
```json
{
  "exId": "ex_001",
  "providerA": {"provider": "openai", "modelId": "gpt-4o-mini"},
  "providerB": {"provider": "anthropic", "modelId": "claude-3-5-haiku"},
  "winner": "A|B|tie",
  "score": 0.62,
  "rationale": "A corrects tense minimally; B rewrites too much.",
  "latencyMsA": 620,
  "latencyMsB": 710,
  "tokensInA": 980,
  "tokensOutA": 210,
  "tokensInB": 960,
  "tokensOutB": 240
}
```

## 4) Harness Design

Provider interface
```ts
interface ChatProvider {
  generate(req: ChatRequest, config: RunConfig): Promise<{
    output: string
    tokensIn: number
    tokensOut: number
    latencyMs: number
    provider: string
    modelId: string
  }>;
}
```

RunConfig
```json
{
  "temperature": 0.3,
  "top_p": 0.9,
  "max_tokens": 300,
  "timeoutMs": 15000,
  "retries": 1
}
```

Execution
- Config-driven (YAML/JSON): dataset path, providers, models, params, judge config, concurrency, cost cap.
- Determinism: fixed parameters; average across 3 runs if provider nondeterministic.
- PromptRun logging (see monitoring doc): requestId, provider, modelId, rubricVersion, tokens, cost, latency, status.

## 5) Metrics & Reports

Metrics to compute
- Quality: pairwise win rate, mean judged score, heuristic pass rate.
- Latency: TTFT/turn p50/p95; tokens/sec.
- Cost: mean tokens in/out; $/1k tokens; $/turn; failures.

Leaderboard report (per task)
```text
Model                         Win%   p95TTFT  p95Turn  $/1k   $/turn  Fail%
openai:gpt-4o-mini            62%    0.85s    1.90s    0.15   0.004   0.8%
anthropic:claude-3.5-haiku    58%    0.92s    2.10s    0.13   0.003   0.6%
```

Significance
- Use bootstrap confidence intervals for win%.
- Flag statistically significant leaders; avoid overfitting to a small dataset.

## 6) Online A/B

- Sticky bucketing per user/session; feature flags for provider/model.
- Guardrails: rate limits, fallbacks, circuit breaker on elevated error/latency.
- Success signals: correction acceptance rate, thumbs up/down, summary rating, churn on slow turns.

## 7) Safety & Compliance

- Red-team prompts in the dataset; track refusal rates and sensitive content handling.
- Avoid storing PII; sanitize logs; rely on hashed IDs.

## 8) Folder Structure (suggested)

```
scripts/bench/
  data/dataset.v1.jsonl
  config/providers.yaml
  run_bench.md (or run_bench.ts/py later)
  report.md (generated)
```

## 9) First Run Plan (Week 1)

- Days 1–2: Draft dataset v1 (200 items) + judge prompt; wire PromptRun logging.
- Day 3: Run 2–3 models per provider; compute win/latency/cost.
- Day 4: Human spot-check; refine judge + heuristics; rerun subset.
- Day 5: Pick defaults (realtime vs background) and fallback; update configs and feature flags.
