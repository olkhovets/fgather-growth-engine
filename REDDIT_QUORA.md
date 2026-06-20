# Reddit / Quora — channel #3 scaffold

ColdIQ/Falco principle: answer the questions your ICP already searches, value-first. Earn trust by
being genuinely useful in the threads B2C marketing/insights leaders read; mention Gather only where
it's the honest answer. This warms the same ICP and routes them to the free microsite (`/r`).

## Where the ICP actually is
- **Reddit:** r/marketing, r/CMO, r/ProductManagement, r/UXResearch, r/consumerinsights (small),
  r/DTC, r/ecommerce, r/branding, r/AskMarketing.
- **Quora topics:** consumer insights, market research, customer interviews, product-market fit,
  brand positioning, survey design, "how do I understand my customers".

## The play (value-first, not spam)
1. Find live questions where the honest answer involves real consumer research (e.g. "how do I know
   what my customers actually want before a launch", "are surveys dead", "how to do qual research fast").
2. Post a genuinely useful answer — a framework or a real insight (what makes buyers say yes/no,
   the survey-vs-interview gap), no pitch. Link the free `/r` teardown only when it's the natural,
   helpful next step.
3. Track which threads drive traffic to `/r` → those topics become repeatable.

## Engine seam (next build — keep it operator-triggered, no auto-posting)
- `lib/community-answer-gen.ts`: given a pasted question + subreddit/topic, draft a value-first answer
  using `gatherWinningSignals` (same winning angles/learnings), in a Reddit-native voice (no marketing
  speak, no links in the first line, genuinely helpful). Return 1-2 answer options.
- `/api/community/answer` (POST, session) → returns drafts. Operator posts manually (auto-posting to
  Reddit/Quora risks bans and is against the spirit — humans post).
- Optional: a small "Communities" tab to paste a question and get a draft.

## Honest constraints
- Reddit/Quora punish self-promotion hard — this only works as real value, posted by a human, sparingly.
- Attribution is loose (UTM on the `/r` link is the cheap proxy).
- Lower volume than ads/email, but very high trust + compounding SEO from Quora answers.

Status: SCAFFOLDED (this doc). Build when the higher-leverage blockers clear.
