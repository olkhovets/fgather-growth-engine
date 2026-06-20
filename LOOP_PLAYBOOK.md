# Autonomous GTM loop — playbook

The hourly loop reads this and does ONE focused iteration. Goal: keep email + LinkedIn
healthy, shift budget to winners, apply Ivan Falco / ColdIQ principles, and build out the
new channels — moving toward 40+ meetings/month for gatherhq.com. Keep each run tight
(monitor + one improvement + one channel step) to bound cost.

## 1. Observe (every run)
- Pull the snapshot:  `KEY=$(grep '^SNAPSHOT_KEY=' .env | cut -d= -f2); curl -s -H "Authorization: Bearer $KEY" https://peter-engine-working-copy.vercel.app/api/snapshot`
- Focus on the `peter@gatherhq.com` workspace. Note: emailSentLast24h, emailPositives, linkedinConnected, linkedin totals, priorityPersonas, budgetPlan.
- Compare to the previous entry in LOOP_LOG.md. What moved?

## 2. Health + smoke test (every run)
- Email working = emailSentLast24h > 0 (or autopilot intentionally off). If 0 unexpectedly, check why (no leads? autopilot off? bounce throttle?) and flag.
- LinkedIn connected = linkedinConnected true and linkedinLastSync recent. If it went stale, the extension stopped exporting — flag Peter to reopen the ad dashboard.
- Smoke-test the live app: curl these expect non-5xx → `/api/snapshot` (200 w/ key), `/dashboard/results` (307), `/api/linkedin/ingest-analytics` (200 GET). Check Vercel runtime logs (MCP) for errors if anything's off.

## 3. Budget shifter (every run)
- Read budgetPlan from the snapshot (total = runningAds × $50). If `moves` is non-empty, surface them in the log: which ads to pause (CTR <0.40%, LinkedIn throttles them) and where to move the freed budget (highest-CTR winners). Execution is Peter's click in Campaign Manager — LinkedIn has no API for it. If budgetPlan.hasData is false but LinkedIn clicks exist, the extension export is missing the per-ad-set array — note it to investigate.

## 4. Ship ONE safe improvement (guardrails — every run)
- Allowed autonomously: copy/creative quality, dashboard/reporting, generation prompts, new read-only endpoints, channel scaffolding, bug fixes.
- NEVER autonomously: flip autopilot/send toggles, launch ads, change send volume/spend, anything that sends real email or spends money. Flag those for Peter.
- Process: edit → `npx tsc --noEmit` (must pass) → `vercel --prod --yes` → smoke-test the new deploy → if a health-check fails, roll back (`vercel rollback` / redeploy previous) and log it. Deploy safe changes (Peter's standing instruction: ship what you make).

## 5. Apply Ivan Falco / ColdIQ principles (rotate, ~1 per run)
ColdIQ/Ivan Falco (one playbook — Falco is Head of Growth at ColdIQ):
- **ICP-first buyer insight**: messaging should reflect what real buyers said made them say yes / nearly say no / surprised them. Bias generation + ad copy toward that.
- **One integrated engine**: each tool/stage is one function in a single GTM flywheel — don't fragment.
- **Stage-specific human vs AI**: automate the cheap/fast stages, keep humans on judgment calls.
- **The flywheel**: content + paid ads + outbound warming the SAME accounts (our surround-sound loop). Push that overlap.
- **Multichannel cadence + hyper-personalization + ABM + AI enrichment.**
- **Deliverability mechanics**: warmup, mailbox rotation, SPF/DKIM/DMARC, reply classification (already in engine — keep healthy).

## 6. Build the channels (one concrete step per run)
Backlog (from ColdIQ's own channel mix). Each reads the SAME winning signals (`gatherWinningSignals`)
and reports back through the persona-keyed ingest. Advance ONE per run; record status here.
Priority order (highest fit for Gather first):
0. **Competitor-testimonial poaching** — people/companies praising Listen Labs, Outset, Evidenza, VoicePanel are warm ICP. See `COMPETITOR_POACH.md` (seed list + `competitor-target-companies.csv` ready for LinkedIn). [status: SEEDED — next: pull specific named people from G2/Greenbook/LinkedIn per competitor, tag personas, build a `source:competitor-poach` LeadBatch generator. Apollo-light: prefer LinkedIn targeting since companies are already known.]
1. **Free-value research microsites** — Gather IS research; publish a finding as a microsite, capture intent. [status: **LIVE v1** — public capture page at `/r` (`app/r/page.tsx`) + `app/api/microsite/capture` creates a Lead in the "Microsite Captures" batch (honeypot + email-validated). This is the capture destination for leaking LinkedIn clicks AND turns a click into an emailable lead. NEXT: point a LinkedIn website-visit ad at `…/r`; later, auto-generate per-topic teardown variants from `gatherWinningSignals`, and wire the actual teardown delivery email.]
2. **LinkedIn content** (organic posts from winning hooks). [status: **BUILT v1** — `lib/linkedin-content-gen.ts` + `/api/linkedin/content` + "Generate posts" button on Results (LinkedIn tab). Drafts ICP-first organic posts from `gatherWinningSignals`, operator-triggered. NEXT: a post-scheduling/queue + reuse the content as the warm-up layer before email/ads to the same accounts (the flywheel).]
3. **Reddit / Quora** (answer questions our ICP searches). [status: SCAFFOLDED — see `REDDIT_QUORA.md` (where the ICP is, the value-first play, the engine seam: `lib/community-answer-gen.ts` + `/api/community/answer`, operator-posts-manually). Build when higher-leverage blockers clear.]
4. **Newsletter sponsorships** (buy attention where B2C marketers read). [not started]
5. **SEO** (rank the research). [not started]
6. **Google Ads / Meta Ads / YouTube** (paid scale once a hook is proven cheap). [not started]
A "step" = research the channel's mechanics (web search), scaffold the engine seam (a generator
or doc), or build a small piece. Don't try to build a whole channel in one run.

## 7. Record (every run)
Append a dated entry to LOOP_LOG.md: what you observed, what you shipped, what you advanced, and
**a clear "NEEDS PETER" list** for anything you couldn't do autonomously (toggles, spend, the
extension reopen, decisions). Keep it short.

## Hard safety
Engine .env points at LIVE Neon/Apollo/Instantly/Anthropic. Reads + code + deploys are fine.
NEVER run autopilot/sends/migrations or flip spend on. Never query the prod DB directly for
secrets (blocked). When unsure, flag instead of act.
