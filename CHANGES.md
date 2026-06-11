# Engine Changelog

## Session 2026-06-10 — Incentives Lab deliverability + Apollo volume (deployed)

The Incentives Lab plumbing already worked (button creates one Instantly campaign per
subject-style × amount combo, names them `Incentives Lab $<amount> <style> — <date>`, tags
each lead for per-amount/style tracking). This session hardened it for an actual launch and
fixed the volume ceiling behind it. **Deployed to production.**

### 1. Incentives Lab — route the offer past the deliverability wall (#1)
**Files:** `app/api/incentives/launch/route.ts`, `app/dashboard/incentives/page.tsx`

Root problem: ~73% of past sends hit strict gateways (Microsoft/Proofpoint/Mimecast/Barracuda)
that quarantine cold mail, and a money-in-subject email is the most quarantinable thing you can
send. The lab was sending to all providers from all inboxes.
- **Recipient provider filter** (`providerFilter`, default `google`): pulls a 6× candidate pool,
  live-classifies any null `emailProvider` by MX (capped 1500/run, persisted — also feeds
  analytics), keeps only Google (or, for `no-gateways`, everything except the 4 strict gateways),
  then takes the send limit. Clear error if nothing matches.
- **Warmed-inbox routing** (`warmedInboxesOnly`, default on): sends only from `warmup_status === 1`
  inboxes via `email_list`, with safe fallback to all inboxes if none warmed.
- UI: a Deliverability block (provider dropdown + warmed toggle) and a **live eligibility readout**
  ("N fresh · N Google · N non-gateway · N unclassified") so the volume/deliverability tradeoff is
  visible before launch. New `/api/incentives/eligibility` endpoint (fast DB groupBy, no MX).

### 2. Incentives Lab — fair A/B matrix (#2)
**File:** `app/api/incentives/launch/route.ts`

The 8-combo cap used a subject-major nested loop, so 4 subjects × 5 amounts tested subject 1 across
all amounts and never sent subjects 3-4. Now combos are ordered **diagonally** (subject i%S,
amount i%A) so the first 8 cover the most distinct subjects AND amounts; a row pass backfills
combos the diagonal skips (e.g. 4×4). Dropped-combo count surfaced in the result.

### 3. Apollo — lift the volume ceiling
**Files:** `lib/apollo.ts`, `app/api/apollo/ingest/route.ts`, `app/dashboard/apollo/page.tsx`

A provider-filtered pull was capped at `MAX_PAGES=25` (~2500 raw scanned → ~225 Google leads at
9% density) AND the route's `maxDuration=60` was the real wall. Now: ingest `maxDuration=300`
(Vercel's current max, accepted on this plan), `MAX_PAGES=80` for filtered pulls (25 for unfiltered,
since those enrich every person and hit the limit fast), and request cap raised 500→1000 (route +
UI). A Google pull can now net real volume instead of stalling at ~225.

### 4. Sending-domain health diagnostic (new Deliverability page)
**Files:** `lib/instantly.ts`, `app/api/instantly/domain-health/route.ts`, `components/DomainHealth.tsx`, `app/dashboard/deliverability/page.tsx`, `components/DashboardSidebar.tsx`

The likely cause of "14k sent, ~0 replies" is mail not landing in inboxes. New diagnostic answers
"which of my sending domains are unhealthy." Pulls every Instantly inbox's warmup status +
**warmup health score** (real inbox-vs-spam placement %, via `POST /accounts/warmup-analytics`),
**groups by sending domain**, and assigns each domain a verdict (healthy / watch / unhealthy /
critical) with reasons — banned/suspended/spam-flagged inboxes, avg health below the 80% floor,
paused, or still-setting-up. Worst domains sort first; expand a row for per-inbox detail
(status, health %, inbox/spam counts, daily limit). New "Deliverability" sidebar page also hosts
the existing recipient provider breakdown. Degrades gracefully to status-only if the warmup
endpoint isn't on the plan.

### 5. Campaign-scoped webhooks for the shared Instantly account
**Files:** `lib/instantly.ts`, `app/api/incentives/launch/route.ts`, `app/dashboard/incentives/page.tsx`

The Instantly account is shared with other people, so an account-level webhook (the old setup) is
wrong — it would fire for everyone's campaigns. Instantly v2 supports **campaign-scoped webhooks**
(`POST /api/v2/webhooks` with a `campaign` UUID). Now the Incentives Lab, after creating + activating
each campaign, registers `reply_received` + `email_bounced` webhooks **scoped to that campaign**,
pointing at our existing `?secret=` handler (lazily creating the workspace `webhookSecret` if absent).
So only OUR campaigns' events reach the loop; replies stamp `replyStatus`/`repliedAt` → the
by-amount/by-style results fill in, bounces suppress. Best-effort (a webhook failure never blocks the
send). The launch message confirms how many webhooks registered (and warns if fewer than expected).
Now extracted into a shared helper `lib/campaign-webhooks.ts` (`getWorkspaceWebhookUrl` +
`registerCampaignWebhooks`), used by BOTH the Incentives Lab and the main send path
(`/api/instantly/send` — all three creation paths: single, style-split, A/B). Each campaign now
registers `reply_received` + `email_bounced` + `lead_out_of_office` scoped to itself. So the whole
system is shared-account-correct: every campaign we create reports its own replies/bounces/OOO to
the loop, and never touches anyone else's campaigns on the shared account.

**Verified live** against the real Instantly account: read + write scopes work, event types
`reply_received`/`email_bounced`/`lead_out_of_office` all valid, and POST is idempotent (re-registering
never duplicates). The webhook list also confirmed the shared account (5 webhooks from multiple parties,
one `campaign=ALL` pointing at someone else's railway worker) — proving scoped is the only correct model.
**Bug fixed:** the Instantly client's `request()` helper always sent `Content-Type: application/json`,
which broke every DELETE (Instantly rejects a body on DELETE) — incl. `deleteCampaign`. Now it only sends
a body + json content-type for methods that need one.

### 6. Incentives Lab autopilot (hands-off pull + append)
**Files:** `lib/apollo-ingest.ts` (extracted), `lib/incentives-autopilot.ts` (new), `app/api/incentives/launch/route.ts` (cron-auth + workspace-wide leads), `app/api/incentives/autopilot/route.ts` (new), `app/api/orchestrate/run/route.ts`, `prisma/schema.prisma` (+`incentivesAutopilot`), `app/dashboard/incentives/page.tsx`

A hands-off pipeline for the Incentives Lab, on the same cron rails as the main autopilot.
- Extracted `ingestForWorkspace` to `lib/apollo-ingest.ts` (shared by the ingest route + autopilot).
- The launch route now accepts CRON_SECRET (`x-cron-secret`) + `workspaceId` and can select leads
  workspace-wide (no batch required) using the workspace's saved incentive config.
- `runIncentivesAutopilotForWorkspace`: when the fresh-lead pool drops below 150 (and Apollo is
  configured + not pulled in the last hour, to protect credits), it pulls 250 more from Apollo, then
  appends up to 300 fresh leads into the rolling campaign (no-gateway providers, warmed inboxes).
- Wired into `/api/orchestrate/run` (the existing external cron) for workspaces with
  `incentivesAutopilot=true`; `maxDuration` raised to 300 so the occasional pull fits. Also a
  dedicated `/api/incentives/autopilot` endpoint (cron fan-out + manual run + toggle).
- UI: an Autopilot card on the Incentives Lab page — ON/OFF toggle + "Run autopilot once now".
- Main autopilot is OFF, so no lead contention; the incentives autopilot owns the pipeline.

### Key finding this session
The whole lead pool is **dry**: 9,395 leads, all sent, 0 fresh/unsent. 840 are Google (8.9% —
confirms the density estimate). The immediate blocker to sending is refilling the pool from Apollo,
not the new filters. Launch path: pull a fresh batch (google = clean/low-volume, no-gateways = ~3×) →
the lab is ready.

---

# Engine Changelog — session (2026-06-08)

## What changed and why

This session: fixed the deployment/login foundation, made the learning loop sound,
and (the headline) overhauled email quality so the pipeline actually produces emails
that make people care about Gather.

---

### 0. Deploy + login foundation

- This fork deploys to Peter's own Vercel project (`peter-engine-working-copy.vercel.app`), NOT growth.gatherhq.com (that's the company's domain, not ours). Fixed the stale "Production URL" in CLAUDE.md.
- Vercel had **zero env vars**, so the deployed app couldn't reach Neon and logins didn't persist. Set `DATABASE_URL`, `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `NEXTAUTH_URL`, and `CRON_SECRET` on production. Accounts now persist forever (they live in Neon, independent of deploys).

---

### 1. Campaign builder stops losing changes (Phase 1a)

**Files:** `app/dashboard/campaigns/[id]/page.tsx`, `app/api/campaigns/[id]/route.ts`, `prisma/schema.prisma` (new `builderPrefsJson` column + migration)

The CTA-URL save was fire-and-forget (no await, errors swallowed). Campaign name, enhancement toggles (fast model, web scraping, landing page, video), and mailbox selection lived only in React state and were lost on refresh. Now all persist (debounced autosave + awaited field saves) with a visible Saving/Saved/Failed indicator. Step tabs are numbered (1. Playbook → 2. Sequences → 3. Send).

---

### 2. Learning loop made sound (Phase 1b)

**Files:** `vercel.json`, `app/api/cron/analytics/route.ts`, `lib/performance-memory.ts`

- **Set `CRON_SECRET`** — without it the entire autopilot + optimizer fan-out silently 401'd (every sub-route requires the bearer; `orchestrate/run` returns "autopilot disabled"). The loop was effectively dead before this.
- **Cron schedule/comment fixed** — comment claimed "every 6 hours" but it ran daily. Now correctly `0 13 * * *` (Hobby plan caps crons at once/day; bump on Pro).
- **Strategy suggestion rebalanced** — it ranked personas by *open rate*, but this is a reply-first, no-links system where click rate is structurally ~0 and opens are unreliable (Apple MPP). Now ranks by **positive replies** (the only per-persona-accurate signal), with open rate as a flagged weak fallback. Same fix applied to the per-lead strategy block in generation.
- Documented the coarse attribution caveat (campaign-level rates spread across all personas in a mixed batch — single-persona batches give the cleanest signal).

---

### 3. Webhook dependency made visible (Phase 1c) + experiment dashboard clarity (Phase 2b)

**Files:** `components/WebhookStatus.tsx` (new), `app/api/webhooks/instantly/setup/route.ts`, `app/dashboard/experiments/page.tsx`

The positive-reply signal the whole loop runs on depends on the Instantly reply webhook. New `WebhookStatus` component shows whether it's live (based on replies actually received) with the exact URL to paste. The experiment dashboard's bare "No experiments yet" is now a 4-step prerequisites guide (API key → generate variants → send leads → reply webhook) with live ✓/✗, so "0 positives" reads as "webhook not set up" instead of "broken."

---

### 4. EMAIL QUALITY OVERHAUL (the headline)

**Files:** `lib/gather-defaults.ts` (new), `app/api/leads/generate/route.ts`, seeded workspace data

Root cause of weak emails: **Peter's workspace was completely empty** — no product summary, ICP, proof points, or incentive. Every email shipped generic with zero proof.

- **Seeded the workspace** with strong Gather content: product summary, B2C ICP, social proof, and **real proof points using Datadog (B2B credibility) and Einstein Bros Bagels / Bagel Brands (the B2C food proof point)** plus verified outcome lines (messaging study in 9 days vs a vendor's 2 months; one report beat 3 quarters of campaigns; 60M panelists). All honest, drawn from gatherhq.com.
- **Generous, rotating gift-card incentive** baked into custom instructions: $100 Uber Eats/DoorDash/Amazon for a 20-min call, up to $250/Sendoso for CMO/VP titles, framed "for your time," never with a link (deliverability rule).
- **Prompt sharpened** with a "MAKE THEM CARE" block: lead with the prospect's world and the transformation, deploy proof as concrete name+result, one idea per email.

**Verified live**: generated a real sample for a DTC soda-brand VP — it opened on the prospect's pain, named Einstein Bros, cited the 9-day speed and pipeline result, offered a $100 DoorDash card (step 1) escalating to $250 Sendoso (step 2), with no links in step 1 and no banned words. Dramatically stronger than baseline.

---

### 5. Website autofill for Product Summary + ICP (Phase 2a)

**Files:** `app/api/onboarding/autofill/route.ts` (new), `app/onboarding/page.tsx`

"Auto-fill from website" button in Settings reads your home page (`scrapeForContext`) and drafts both Product Summary and ICP in one Claude call (`callAnthropic`). Non-destructive — it fills the fields for you to review and edit before saving.

---

### 6. Help page + flow polish (Phase 3)

**Files:** `app/dashboard/help/page.tsx` (new), `components/DashboardSidebar.tsx` (new), all 5 dashboard pages

- New **"How it works" page** walking through the whole loop (setup → AI writes → send → results → learn) plus the reply-first/no-links rules and the webhook setup.
- Extracted the sidebar (copy-pasted across 5 pages) into **one shared `DashboardSidebar`** — fixes the "out of sync" inconsistency, adds the Help link, and renames the confusing **"Launch control" → "Generate & send"**.
- Numbered step tabs (1. Playbook → 2. Sequences → 3. Send) in the campaign builder.

---

### 7. Proof-point + incentive editors in Settings

**Files:** `app/api/onboarding/route.ts`, `app/onboarding/page.tsx`

Settings now has a **Proof points** editor (one customer story per line, "Name: result") and a **Custom instructions & incentives** editor (the gift-card policy, tone, things to avoid). Both round-trip through `/api/onboarding`. Previously only reachable via the Generate & send / playbook flow.

### 8. Default experiment set (day-one Experiments page)

**Files:** `lib/experiment-defaults.ts` (new), `app/api/optimize/variants/seed/route.ts` (new), `app/dashboard/experiments/page.tsx`

A curated 12-variant set (3 each for subject / hook / CTA / incentive — the incentive variants rotate Uber Eats / DoorDash / Amazon). New idempotent `/variants/seed` endpoint inserts them with no Claude call, exposed as a **"Start with a default set"** button on the empty Experiments state. Peter's workspace was seeded directly so it's populated now.

---

## What's next (not done)

1. **Surface the sample-email preview more prominently** now that proof points make it shine.
