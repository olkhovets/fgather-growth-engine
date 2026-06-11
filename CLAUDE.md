# Claude Context

This is **Peter's personal working copy** of the Gather Growth Engine — forked from the original shared codebase. Changes here are Peter's own experiments, fixes, and features and may diverge from the upstream repo.

## Repo identity

- **Project:** Gather Growth Engine (`gather-growth-engine`)
- **Owner:** Peter Olkhovets (`peter@gatherhq.com`)
- **Nature:** Personal fork / working copy — not the canonical upstream. Peter works at Gather, but this is his own separate project and is NOT connected to the company's growth website.
- **Production URL:** [peter-engine-working-copy.vercel.app](https://peter-engine-working-copy.vercel.app) — Peter's own Vercel project (`olkhovets-projects/peter-engine-working-copy`). NOTE: growth.gatherhq.com is the company's upstream site; this fork does not deploy there and Peter doesn't control that domain.
- **Spec:** [docs/SPEC.md](docs/SPEC.md)

## Stack

- Next.js 14 (App Router), TypeScript, Tailwind CSS
- Prisma + SQLite (dev) / Postgres (prod)
- NextAuth.js (Credentials + optional Google OAuth)
- Anthropic API (Claude) — users supply their own keys
- Instantly — email sending, users supply their own keys

## Mission (read this first, every session)

Peter needs to book **40 demos this month**. 3 months of runway. This is existential.

The goal of this tool is: find the right B2C company people → write great personalized emails → send via Instantly → pull results back → learn from them → iterate → get better automatically.

**ICP:** B2C company people — CMOs, VP Marketing, Brand Directors, Head of Growth, Marketing Managers at DTC/consumer brands (beauty, food, fashion, retail, consumer apps).

**Sending:** ~60 domains in Instantly. Sender signs off as "Peter from Gather" or "Gather".

**No links ever in any email step.** Reply-first CTA only ("worth a quick chat?"). Send calendar link only after they reply. This is a hard deliverability rule — Calendly is blocklisted by enterprise gateways.

**Incentives available (use them, they work):** Uber Eats cards, DoorDash cards, Amazon gift cards, Sendoso gifts — up to $1k. Rotate and A/B test all of them.

**Tone:** Abrasive, unique, personable, human. Not corporate. Real person talking to a real person.

**Emails must never contain AI-sounding language. Hard banned:**
- Em dashes (—) — never, ever
- Words: leverage, delve, streamline, synergy, unlock, empower, revolutionize, game-changer, cutting-edge, innovative, seamlessly, robust, scalable, holistic, transformative, utilize, facilitate, spearhead, elevate, supercharge, reimagine, best-in-class, world-class, dynamic, impactful
- Filler openers: "I hope this finds you well", "I wanted to reach out", "I'm reaching out because"
- Any phrase that sounds like it was written by a chatbot
- Oxford comma overuse, overly complex sentence structures
- Bullet points in emails (prose only)

Emails should read like a sharp human wrote them in 5 minutes — casual, direct, a little cocky, specific to the recipient.

**When starting a new session:** read the codebase, check recent git log, continue making progress toward the mission. The tool should constantly improve: better emails, better Instantly analytics visibility, better dashboard, better learning loop.

## Key conventions

- User API keys (Anthropic, Instantly) are encrypted per workspace in the DB
- Cost model: zero platform cost — users bring their own API keys
- Autopilot mode: hands-off generate → send pipeline
- Operator email notifications on every engine action (toggleable)
