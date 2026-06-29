# Sending portal — how email outbound is driven (CLI-first)

Peter drives sending from the **terminal**, not the dashboard. Keep the dashboard simple; this doc + `scripts/engine.sh` are the source of truth for the sending path. There is no separate send binary — everything is API routes, wrapped by `engine.sh`.

## TL;DR

```bash
bash scripts/engine.sh target          # ⮕ current reply rate, gap to 2%, the ONE thing to fix now
bash scripts/engine.sh status          # at-a-glance health (read-only)
bash scripts/engine.sh grade           # are the emails good? (read-only)
bash scripts/engine.sh recycle         # re-draft the pool (no send)
bash scripts/engine.sh send <batchId>  # real sends (prompts first)
bash scripts/engine.sh loop            # run the whole daily loop by hand
```

**The 2% reply-rate goal lives in `engine.sh target`** — it computes the current rate, the gap, and the single binding constraint (not sending → deliverability → targeting → copy), so you always work the real lever. Logic: `lib/reply-target.ts`.
Config comes from `.env`: `BASE_URL`, `CRON_SECRET`, `SNAPSHOT_KEY`, optional `WORKSPACE_ID`.

## The pipeline (one diagram)

```
Apollo ingest ──▶ leads (persona-tagged)
      │
      ▼
/api/leads/generate ──▶ Claude writes sequence
      │  · inject research rules (lib/cold-email-research.ts) + proven learnings + active A/B experiments
      │  · GRADE step1 (lib/email-grader.ts); regenerate once if below 70; log avg quality
      ▼
/api/instantly/send ──▶ create campaign, upload, ramp, activate, register webhooks
      │
      ▼
/api/webhooks/instantly ──▶ classify reply (positive/objection/ooo/not_interested)
      │  · recordReplyObservation → PerformanceObservation (per persona/vertical)
      ▼
THE LEARNING LOOP (daily cron → fan-out):
  /api/optimize/iterate              deliverability guardrail + incentive & STYLE outcome rating
  /api/optimize/mine-replies         reply TEXT → new learnings
  /api/optimize/research-experiments web research → personalized A/B variants (📊-tagged)
  /api/optimize/variants/evaluate    Wilson-rate variants → promote winners into learnings / kill losers
  /api/optimize/variants/generate    top up the experiment pool
```

## Endpoints + auth

| Route | Auth | What |
|---|---|---|
| `GET /api/snapshot?key=$SNAPSHOT_KEY` | SNAPSHOT_KEY | Read-only health: sends24h, positives, **deliverability verdict**, **winning style**, priority personas. |
| `GET /api/leads/grade` | session **or** `Bearer $CRON_SECRET` | Grade the existing pool vs the research rubric. `?limit=&batchId=&workspaceId=`. |
| `POST /api/leads/generate` | session or `Bearer $CRON_SECRET` | Draft sequences. Body: `{batchId}` or `{recycle:true}`, `useFastModel`. |
| `POST /api/instantly/send` | session or `Bearer $CRON_SECRET` | Upload + activate. Body: `{batchId, sendLimit, skipFailingLeads}`. |
| `GET /api/orchestrate/run` | `Bearer $CRON_SECRET` | One autopilot pass (generate + send), ~30 leads. |
| `GET /api/cron/analytics` | `Bearer $CRON_SECRET` | The daily loop entry; fans out to everything above. Vercel cron `0 13 * * *`. |
| `GET /api/optimize/{iterate,mine-replies,research-experiments,variants/evaluate,variants/generate}` | `Bearer $CRON_SECRET` | Individual loop steps. |
| `GET /api/instantly/domain-health` | session only | Per-domain inbox placement (the full detail behind the snapshot verdict). |

## Where the quality / research / deliverability signals show up (no new dashboards)

- **Email quality** — `engine.sh grade`, and per-batch in the activity log line: `Generated N sequences — avg quality 94/100, 3 auto-rewritten`. Grader = `lib/email-grader.ts`, rubric = `lib/cold-email-research.ts`.
- **Deliverability / spam** — `snapshot → health.deliverability.verdict` (healthy/unhealthy/critical). The optimizer throttles volume and raises a `DELIVERABILITY ALARM` when placement is bad. Logic in `lib/deliverability.ts`, gate in `lib/incentives-optimizer.ts`.
- **Winning email style** (by actual positive replies, Wilson-rated) — `snapshot → email.winningStyle` + the optimizer action line `Style outcomes: …`. Logic in `lib/style-performance.ts`.
- **What the engine has learned** — `Workspace.learningsJson` (injected into every generation). Fed by reply-mining + promoted experiment winners.

## Email styles

Styles live in `STYLE_GUIDES` in `app/api/leads/generate/route.ts`; routing is `inferStyle()`.
- `specialist-proof` — per-company read + real Gather proof + gift-for-demo, reply-first. **Proven: booked a meeting with no incentive.** Default for exec/brand/consumer ICP.
- `lean-personal` — research-backed (problem-first, real trigger, single value-ask, ≤75 words, grade-5). Current `inferStyle` default.
- `pain-led`, `insight-hook`, `social-proof`, `direct-ask` — situational.

The "web research" is **baked** into `lib/cold-email-research.ts` (the deployed app can't live-web-search); refresh it by re-running the research and editing that file — the research-experiment generator then turns the new tactics into A/B variants automatically.

### The style factory (propose → self-grade → approve → rotate → reply-rate)

The engine drafts brand-new candidate styles, you approve them from the CLI, approved ones enter rotation and get reply-rated. Human-in-the-loop: **nothing proposed is ever sent until you approve it.** Logic in `lib/style-proposer.ts`; stored migration-free in `PromptExperiment` (dimension `"style"`, status `proposed`→`approved`→`killed`, isolated from the A/B dimensions).

```bash
bash scripts/engine.sh styles            # list proposed + approved (self-test grade + live reply rate)
bash scripts/engine.sh styles propose    # draft new candidates, self-graded on sample emails
bash scripts/engine.sh styles approve <id>   # put it into the generation rotation
bash scripts/engine.sh styles reject <id>
```

- **Propose** (`/api/styles/propose`): Claude designs styles grounded in the research + proven learnings + the current winning style, then self-tests each by generating sample emails and grading them (`lib/email-grader.ts`). Runs in the daily loop but only tops up to ≤3 pending; approval is always manual.
- **Approve** (`/api/styles/approve`): flips status to `approved`. `generate` merges approved styles into `STYLE_GUIDES` and routes ~1 in 6 un-pinned leads to them (proven styles keep the majority), so they accrue real sends.
- **Reply-rate**: once they have sends, `lib/style-performance.ts` rates them by positive-reply rate alongside the built-ins → surfaces as `snapshot → email.winningStyle`.

## Hard boundaries (unchanged)

`.env` points at **live** Neon + Apollo + Instantly. Reading/editing/grading is safe. **Never** auto-fire `send` / `autopilot` / `loop` / Apollo pulls without Peter — `engine.sh` prompts on all of them. Don't `git push live main`.
