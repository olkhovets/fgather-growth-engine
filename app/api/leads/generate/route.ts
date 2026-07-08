import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { callAnthropic } from "@/lib/anthropic";
import { getAggregatedMemory } from "@/lib/performance-memory";
import { loadActiveExperiments, assignExperiments, loadLearnings, learningsBlock } from "@/lib/experiments";
import { pickWildcard } from "@/lib/wildcard-approaches";
import { parsePlaybook } from "@/lib/playbook";
import { scrapeForContext } from "@/lib/scrape";
import { generateLeadResearch } from "@/lib/research";
import { generateLandingPageContent, landingPageContentForEmailPrompt } from "@/lib/lp-content-gen";
import { logActivity } from "@/lib/activity";
import { validateEmailSteps, autoFixEmailContent } from "@/lib/email-validator";
import { researchPlaybookBlock } from "@/lib/cold-email-research";
import { gradeEmail, judgeEmailContent } from "@/lib/email-grader";
import { loadApprovedStyles } from "@/lib/style-proposer";
import { generateSubjectCandidates, scoreSubject } from "@/lib/subject-engine";
import { mechanismForIndex, subjectMechanismBlock, MECHANISM_TAG_PREFIX } from "@/lib/subject-mechanisms";
import { brandProofBlock } from "@/lib/brand-proof";
import { deepResearchLead, deepResearchBlock } from "@/lib/deep-research";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

// Allow up to 60s so a few Anthropic calls can finish (Vercel Pro; Hobby may still cap at 10s)
// Up to 300s (Vercel Fluid): deep web research per lead is slow but higher-signal; give it room.
export const maxDuration = 300;

const MAX_BODY_WORDS = 40;       // hard ceiling — anything longer gets cut. Feedback: bodies are indigestible blocks; a few tight lines only.
const PUNCHY_TARGET_WORDS = 28;  // the short target the shortener cuts down to — 3 lines: the personal read, the proof, the ask.

// THE REPLY FORMULA — the standing OKR (memory: okr-reply-formula), injected into EVERY email regardless
// of style. We optimize for one thing: a human hitting reply. Every email must hit all five. This frames
// the whole prompt; the per-style guide below is just the flavor it's delivered in.
const REPLY_FORMULA = `*** THE REPLY FORMULA — this is the whole job. Every email must hit all FIVE, whatever the style. ***
We are optimizing for ONE outcome: a busy B2C marketing leader feels a REAL person is reaching out to them specifically, to solve a problem they have and make them money, and hits REPLY. Not opens, not awareness. Hit all five or the email fails:
1. SUBJECT that stops the scroll — inviting and specific, like a person, not a campaign. The strongest kind is a concrete value-exchange or curiosity, e.g. "$50 for 3 minutes", "worth $100 of your time?", "steal [competitor]'s buyers", "what [company]'s customers won't tell you". Provocative, a sharp number, a curiosity gap, quirky, or one fitting emoji are all fair game. Never generic ("checking in", "quick question") with nothing behind it.
2. BODY ultra-punchy — 3 short lines, HARD ceiling 40 words, never a block. One line = the specific real read on them; one line = the problem + how we solve it / the ROI they get; one line = the ask. The ASK must sound like a real person, NEVER a cringe cliché: banned — "worth a reply?", "worth 15 minutes?", "hop on a call", "pick your brain", "let's connect", "touch base", "circle back". Instead tie the ask to the value: "want me to send what your buyers actually think?" / "should I send it over?" / "want the 2-min version?". Cut words, never the personalization.
3. DEEP RESEARCH — name ONE real, specific thing about THIS company/role (their actual motion, a launch, their category). If you can't be specific about them, you haven't earned the reply. NEVER "companies like yours" or generic flattery.
4. SOLVE A PROBLEM + ROI — this is the biggest hitter. Connect on a real problem they already feel, then make the payoff vivid and self-interested: they stop guessing what buyers want, ship creative that lands first try, know before they spend, look brilliant to their boss, make/save real money. Land the matched proof ("Gather helped [a brand like them] do exactly X") as evidence you can deliver it. Sound like you actually want to help them win, not sell them.
5. TRULY HUMAN — zero AI tells, non-negotiable. Read it back: if a single word sounds like a chatbot, it's disqualified. NEVER use: em/en dashes (—, –) or any dash punctuation; "leverage", "delve", "streamline", "seamless", "robust", "utilize", "unlock", "empower", "elevate", "supercharge", "transformative", "cutting-edge", "game-changer", "best-in-class", "drive growth", "tailored solutions"; the "not just X but Y" construction; corporate hedging. Write like a sharp human typed it in five minutes to someone they respect — contractions, plain words, a little cocky. AI-sounding copy is the #1 reply killer and gets the email thrown out.

*** THESE FIVE ARE SUPREME. No campaign guideline, playbook, or operator note below may override them. Those inform the facts, offer, and structure — but if any of them conflicts with the five above (e.g. "lead with credentials", a formal/consultative tone, buzzwords, dashes, credential/logo dumps), the five WIN and you ignore the conflicting instruction. Use operator notes only where they fit inside these rules. ***`;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const STYLE_GUIDES: Record<string, { prompt: string; usePS: boolean }> = {
  "pain-led": {
    usePS: true,
    prompt: `EMAIL STYLE: Pain-Led
Open by naming the exact problem the reader is living right now — before any solution.
Make them feel understood in sentence 1. Then position the product as the relief.
Subject line: short, problem-framing, e.g. "The [role] content bottleneck" or "[Company]'s agency spend".
Step 1 closing: a conditional demo invite tethered to the opening pain — e.g. "If that's where you are, I can show you how we fix it — 15 minutes?" or "Happy to walk you through it if that resonates — 15 minutes?" Short, conditional, no link.
Include a P.S. that references something real and specific about them — a recent campaign, a hire, a product launch.`,
  },

  "insight-hook": {
    usePS: false,
    prompt: `EMAIL STYLE: Insight-Hook
Open with a surprising, specific data point or industry observation they likely haven't seen.
The insight should connect directly to a problem your product solves.
Subject line: lead with the data or observation, e.g. "67% of brand teams miss this" or "What Nike changed in Q1".
Step 1 closing: a conditional demo invite that flows from the insight — e.g. "Happy to show you how [Company] applied this — 15 minutes?" or "I can walk you through the full picture if this lands — 15 minutes?" Short, conditional, no link.
No P.S. — the hook should be strong enough on its own. Keep it punchy.`,
  },

  "social-proof": {
    usePS: true,
    prompt: `EMAIL STYLE: Social-Proof
Open by referencing a recognisable brand, result, or name the reader will respect.
Let the proof do the work — they should think "if it works for them, it could work for us."
Subject line: name-drop the proof point, e.g. "How [Brand] cut agency spend 40%" or "What [Company] is doing differently".
Step 1 closing: let the proof earn the demo invite — e.g. "Happy to show you what we built for them — 15 minutes?" or "I can walk you through what we did for [Brand] if relevant — 15 minutes?" Short, conditional, no link.
Include a P.S. that reinforces credibility — another proof point, a stat, or a relevant quote.`,
  },

  "specialist-proof": {
    usePS: false,
    prompt: `EMAIL STYLE: Specialist-Proof (per-company read + real proof + gift-for-demo, reply-first)
Sentence 1: a SPECIFIC read on what THIS company is actually doing — name their real angle/motion using the company research, e.g. "Seems like [Company] is all about [their actual play]." It must feel hand-written for them, never a template.
Sentence 2: the honest tension — that angle usually drives [the upside], but the hard part is knowing what customers actually want BEFORE you spend, not after.
Then 2-3 short lines of REAL Gather proof — use ONLY these, NEVER invent metrics or ARR numbers: brands like Belk, Staples, Bagel Brands and Empire Today run our AI consumer research; backed by Menlo; built by the team behind Gartner Peer Insights; real customer answers in days, not a six-week study; AI-moderated interviews against a 60M-person panel.
Specialization line: ONE concrete thing Gather would do for THIS company specifically, tied to their product/category.
Offer: frame the value as conviction, then a gift — e.g. "Confident it'd help [Company], so I'll put a [GIFT] behind a 20-minute demo." Use the workspace's incentive amount + gift type if provided (see custom instructions); otherwise offer a gift card for their time. NEVER promise revenue figures or guarantees we can't keep (no "add $X ARR or it's free", no fake case-study numbers).
Subject: specific to them, e.g. "[Company] + faster customer answers" or "the consumer research behind Belk and Staples".
Step 1 closing: reply-first only — "Worth it? Reply 'yes' and I'll send the details." (optionally invite a "no"). NO links, ever — Calendly is sent only after they reply.
No P.S. Keep it tight, human, a little cocky. Banned AI words still apply.`,
  },

  "lean-personal": {
    usePS: false,
    prompt: `EMAIL STYLE: Lean-Personal (research-backed: every rule below is from cold-email reply-rate data)
Sentence 1 (about THEM, never you): a real, specific trigger about this company — a launch, hire, funding, expansion, or their actual current motion from the research — plus a "so this likely means…" bridge. Not generic praise, not person-trivia. (Real personalization ~5x's replies.)
Sentence 2: name a problem that trigger implies they already feel, BEFORE any mention of the product. (Leading with the solution cuts replies up to 57%; problem-first lifts ~20%.)
Sentence 3: one specific, concrete outcome with a named proof customer — never vague claims. (Named social proof +41% replies.)
Close: exactly one low-friction, reply-first ask that offers something worth their time even if they don't buy (a teardown/benchmark/sample), e.g. "Want me to send a quick example built on your category? Just reply." One question max, no calendar link. (Value-based offers beat generic asks +28%.)
Keep the whole body under 75 words, grade-5 reading level, short sentences, contractions, more "you" than "I". No P.S. No em dashes, no AI-tell words.
Subject: 1-4 lowercase words anchored to their world, no sell.`,
  },

  "direct-ask": {
    usePS: false,
    prompt: `EMAIL STYLE: Direct-Ask
No warm-up. Shortest path to the ask.
One sentence on what you do. One sentence on why it matters to them specifically. One ask.
Confident peer-to-peer tone — write like a colleague, not a vendor.
Subject line: ultra-short and direct, e.g. "Quick question" or "[Company] + Gather".
Step 1 closing: one crisp conditional demo ask — e.g. "Worth 15 minutes?" or "Open to seeing it?" One line, nothing more. No link.
No P.S. — adding one undermines the directness. Keep the whole email under 80 words.`,
  },

  // Direct-Incentive: the short, money-FORWARD style. Every positive reply Gather has booked came
  // from blunt money-direct copy (we-pay-you / direct-offer / on-us ~0.5%), while the long
  // credentialed specialist-proof style converted 0 across ~3k sends. This keeps the gift but
  // strips the credential essay: lead with the conviction-backed offer, one proof line, the ask.
  "direct-incentive": {
    usePS: false,
    prompt: `EMAIL STYLE: Direct-Incentive (short, money-forward, gift-for-demo, reply-first)
No warm-up, no essay. The whole email is UNDER 65 words. Confident peer-to-peer, a little cocky.
Sentence 1: the offer framed as CONVICTION, not a bribe — we are so sure Gather helps [Company] that we'll put the gift behind 20 minutes. Use the workspace's incentive amount + gift type (see custom instructions), e.g. "We're sure enough Gather helps [Company] that I'll put a [GIFT] behind 20 minutes."
Sentence 2: ONE line of real proof, pick just one (never stack them): brands like Belk, Staples, Bagel Brands and Empire Today run our AI consumer research; backed by Menlo; team behind Gartner Peer Insights; real consumer answers in days, not a six-week study. NEVER invent metrics, ARR, or guarantees.
Step 1 closing: reply-first only — one crisp line, e.g. "Worth a reply?" or "Reply 'yes' and I'll send the details." NO links, ever.
No P.S. Banned AI words still apply. Money is framed as confidence, never "free gift, no catch".`,
  },

  // Holiday-Incentive: direct-incentive + a human nod to the long weekend. Most senders pretend it's a
  // normal day; acknowledging it is a pattern-interrupt that disarms and lands whether they read it now
  // or when they're back. SEASONAL — written for a US holiday week (e.g. July 4th); edit/retire after.
  "holiday-incentive": {
    usePS: false,
    prompt: `EMAIL STYLE: Holiday-Incentive (short, money-forward, holiday-aware, zero-pressure, reply-first)
The whole email is UNDER 60 words. Warm, confident peer-to-peer, a little cocky. Never corporate.
Sentence 1: a real, specific read on what THIS company is doing (use the research) - names them, about THEM. One sharp line.
Holiday nod (human, not a gimmick): acknowledge the long weekend / holiday week naturally and LOW-PRESSURE - you are reaching out now so it is waiting when they are back, no rush. e.g. "figured you are half-out the door for the long weekend, so no rush" or "know it is a holiday week".
The offer as CONVICTION: we are sure enough Gather helps [Company] that I will put a [GIFT] behind 20 minutes whenever you are back. Use the workspace incentive amount + gift type. NEVER invent metrics/ARR/guarantees.
ONE proof line, pick just one: brands like Belk, Staples, Bagel Brands and Empire Today get real consumer answers in days, not a six-week study.
Close: reply-first, zero pressure - "reply whenever you are back and I will send details." NO links, ever.
No P.S. Subject: short, lowercase, may nod to the timing, e.g. "after the 4th?" or "[company] + when you are back".`,
  },

  // Founder: the classic founder-to-buyer note. Quick credential + a direct demo ask. No gift, no essay.
  // Credibility-led ("here is who we are, worth a look?") rather than money-led.
  "founder": {
    usePS: false,
    prompt: `EMAIL STYLE: Founder (quick credential + demo ask, human, no gift)
Write as the FOUNDER of Gather emailing a peer. Warm, confident, direct. UNDER 55 words. No fluff, no corporate, no buzzwords.
Sentence 1: one specific line about what THIS company does (use the research) so it is clearly written for them, not a blast.
Sentence 2: a quick credential in one breath - who we are and why we are credible. Pick the 2-3 MOST relevant proof points, never all: founder of Gather; we run AI consumer research; brands like Belk, Staples and Bagel Brands use us; backed by Menlo; built by the team behind Gartner Peer Insights; real consumer answers in days. NEVER invent metrics, ARR, or guarantees.
Close: a direct, low-friction ask to MEET FOR A QUICK DEMO - e.g. "Worth a quick 15-min demo?" or "Open to a look?" Reply-first. NO links, ever. No gift, no money.
No P.S. No em dashes, no AI-tell words. Subject: short, lowercase, founder-casual, e.g. "[company] + gather" or "quick intro".`,
  },

  // Founder-Incentive: the COMBO — founder credential + demo ask + the money offer, kept CONTINUOUS
  // across the multi-step sequence (gift introduced once in step 1, called back in step 2+, never reset).
  "founder-incentive": {
    usePS: false,
    prompt: `EMAIL STYLE: Founder-Incentive (founder credential + demo ask + money offer, multi-step CONTINUOUS)
Write as the FOUNDER of Gather emailing a peer. Warm, confident, direct. Each step UNDER 60 words. No fluff, no corporate, no buzzwords.
STEP 1 - all four, in order, tight:
 (a) one specific line about what THIS company does (use the research) so it is clearly for them;
 (b) a one-breath founder credential, pick the 2-3 MOST relevant, never all: founder of Gather; we run AI consumer research; brands like Belk, Staples and Bagel Brands use us; backed by Menlo; built by the team behind Gartner Peer Insights; real consumer answers in days;
 (c) the offer as CONVICTION plus the gift, stated plainly the FIRST time: "confident enough Gather helps [Company] that I will put a [GIFT] behind a quick 15-min demo";
 (d) a direct reply-first ask. NO links, ever.
STEP 2+ - thread as a reply (Re: same subject). CONTINUITY MATTERS: assume step 1 already happened. Call the SAME gift back ("that [GIFT] still stands" / "the [GIFT] is still yours if you book"), add ONE new proof point or angle, and repeat the demo ask. NEVER re-introduce the gift as if new; NEVER change the amount or gift type.
STEP 3 - a gentle breakup or one fresh angle, keeping the gift and the ask consistent with the earlier steps.
NEVER invent metrics, ARR, or guarantees. No em dashes, no AI-tell words. Subject: short, lowercase, founder-casual, e.g. "[company] + gather".`,
  },

  // Outcome-Hook: attention-grabbing, emoji subject, sells the HUMAN OUTCOME (win/status/time), not the
  // product. For a busy marketing director/CMO. Bolder than the plain styles on purpose (they get ~0%).
  "outcome-hook": {
    usePS: false,
    prompt: `EMAIL STYLE: Outcome-Hook (attention-grabbing, ONE emoji in the subject, sells the human OUTCOME)
For a busy marketing director/CMO who cares about their WIN, their boss, and their TIME. Grab attention. Whole body UNDER 50 words, punchy, confident, human.
SUBJECT: lead with exactly ONE relevant emoji, then a short lowercase phrase naming a concrete OUTCOME they crave. Make it about THEIR career/life, not the product. Pick one, vary them, tailor to the company/a real competitor:
  "🏆 steal [competitor]'s customers" · "⏰ go home early, [firstName]" · "🎯 impress your CMO" · "📉 stop guessing what [company]'s buyers want" · "👀 what [company]'s customers actually think" · "🧠 the campaign that makes you look brilliant" · "📊 content [company] can finally cite" · "⚡ creative that lands first try".
  One emoji only, never a stack. No ALL CAPS. Not clickbait you can't pay off.
BODY:
 - Sentence 1: name the OUTCOME they want, specific to them — hit the number, ship creative that lands first try, steal share from a named competitor, kill the 6-week research wait (get home earlier), research the CMO trusts, content that gets cited, look like the genius in the room.
 - Sentence 2: how Gather delivers it in ONE line — real consumer answers in days, not a six-week study; brands like Belk and Staples use us. Pick one proof, never stack.
 - Offer + ask: tie in the gift as a nudge ("I'll put a [GIFT] behind a 15-min demo"), then one reply-first ask. NO links.
Sell the benefit to the PERSON (winning, status, time), not features. NEVER invent metrics/ARR/guarantees. No em dashes, no AI-tell words. The subject emoji is intentional and wanted.
Rotate the ANGLE across leads so they're not all the same — career-win (impress the CMO, look brilliant, always call it right), time-back (get weekends back, stop late-night guessing), competitive (steal share from a named competitor, beat them to the insight), loss-aversion (stop paying for creative that flops, you're guessing expensively).
HONESTY (non-negotiable): the subject makes a promise the BODY must actually pay off. No fake urgency or scarcity, no invented results, no "Re:"/"following up" implying prior contact, no fabricated personal details. Captivating, never deceptive.`,
  },

  // Curiosity-Gap: a pure attention/insight play, NO gift. Opens a real, honest knowledge gap about
  // THEIR customers and offers a specific taste of the answer. Tests whether curiosity beats money.
  "curiosity-gap": {
    usePS: false,
    prompt: `EMAIL STYLE: Curiosity-Gap (honest curiosity, insight-forward, value not money, ONE emoji subject)
For a marketing director/CMO. Open a REAL knowledge gap about what THEIR customers actually think — then offer a concrete taste of the answer. Whole body UNDER 45 words. No gift, no money.
SUBJECT: one relevant emoji + a short lowercase curiosity line grounded in something true about them, e.g. "🔍 what [company]'s customers actually think" · "💬 the thing your buyers won't say in a survey" · "❓ why your last campaign may have underperformed" · "👀 [company]'s buyers vs what you assume". Never clickbait you can't pay off.
BODY:
 - Sentence 1: name the specific gap — the thing they can't see about their buyers today (tie to their category/product from the research).
 - Sentence 2: we close it with real consumer answers in days (not a six-week study); brands like Belk and Staples use us. One proof, never stack.
 - Close: a low-friction, value-first ask — offer to send ONE real insight or a quick teardown for their category. Reply-first, NO links.
HONESTY (non-negotiable): the curiosity in the subject must be genuinely answered by the body. No fake urgency, no invented stats, no fake prior-contact, no fabricated details. Intriguing, never deceptive. NEVER invent metrics/ARR. No em dashes, no AI-tell words.`,
  },

  // Quirky-Incentive: the STAR of the current test — maximum-captivation subject + ULTRA-short body +
  // the money does the closing. Subject drives the open/click; body is 2-3 tiny lines; gift is the hook.
  "quirky-incentive": {
    usePS: false,
    prompt: `EMAIL STYLE: Quirky-Incentive (captivating subject + ULTRA-SHORT body + money does the talking)
The SUBJECT does the work; the tiny body + the gift close. Whole body UNDER 30 words. Zero clutter.
SUBJECT — maximum captivation, minimal length. Rotate across these flavors so they're not samey:
  · a punchy provocative outcome: "go home early", "steal their customers", "impress your CMO", "stop guessing"
  · one or two fitting emojis: "🍿", "🏆 💰", "🎯", "👀"
  · a single curiosity word or the brand: "gather", "quick one", "worth $100?"
  Make someone WANT to click. One emoji-stack is fine. No ALL CAPS. Never clickbait the body can't back up.
BODY — under 30 words, 2-3 tiny sentences MAX, no essay, no proof-stacking (one brand name only if it fits):
  1. one line on what's in it for THEM, tied to their company/category (real);
  2. the money, plainly: "I'll send you a [GIFT] to take a 15-min demo";
  3. one reply-first ask. NO links.
Let the subject + the gift carry it. No credential paragraph.
STEP 2+ (reply thread, subject = "Re: " + step 1 subject) — even SHORTER. Call the SAME gift back ("that [GIFT] still stands"), one nudge, the ask. NEVER re-introduce or change the gift amount/type. Keep every step consistent so the sequence reads as one continuous thread.
HONESTY: the subject must connect to something real in the tiny body — captivating, not a lie. NEVER invent metrics/ARR. No em dashes, no AI-tell words.`,
  },
};

/**
 * Auto-assign an email style based on persona + industry when no explicit style is passed.
 * Logic: analytical roles → insight-hook, exec/brand → social-proof, ops/agency → pain-led, default → direct-ask
 */
function inferStyle(persona?: string | null, industry?: string | null, vertical?: string | null): string {
  const p = (persona ?? "").toLowerCase();
  const ind = (industry ?? vertical ?? "").toLowerCase();

  // C-suite and VPs — Gather's core ICP. DATA-DRIVEN SWITCH (2026-06-25): the long credentialed
  // specialist-proof style converted 0/2,985 sends, while every positive Gather has ever booked
  // came from short, money-direct copy (~0.5%, ~10x). direct-incentive is that winner distilled.
  // Fresh-pull default now points at it so new Apollo leads get the proven copy, not the dead one.
  if (/cmo|ceo|cfo|chief|vp |vice president/.test(p)) return "direct-incentive";

  // Analytical roles (data, product, strategy) respond to insight-hook
  if (/analyst|data|product|strategy|insight|research/.test(p)) return "insight-hook";

  // Brand/marketing/content managers — core ICP, money-direct winner (see note above)
  if (/brand|content|creative|marketing manager|campaign/.test(p)) return "direct-incentive";

  // Operations, agency, and growth roles respond to pain-led
  if (/operat|agency|growth|demand|lead gen|sdr|bdr/.test(p)) return "pain-led";

  // Industry signals
  if (/agency|consult|pr firm/.test(ind)) return "pain-led";
  if (/tech|saas|software|fintech/.test(ind)) return "insight-hook";
  if (/retail|consumer|fmcg|cpg|fashion|food/.test(ind)) return "direct-incentive";

  // Default — research-backed lean-personal (problem-first, real trigger, single value ask)
  return "lean-personal";
}

/**
 * Detect whether the recipient works in a B2C brand context (consumer brands, retail,
 * creative/marketing roles) vs. a B2B operations context. Used to shift language
 * register: B2C brand people think in craft, voice, audience — not ROI/efficiency.
 */
function inferRegister(persona?: string | null, industry?: string | null, vertical?: string | null): "btoc-brand" | "btob-ops" {
  const p = (persona ?? "").toLowerCase();
  const ind = (industry ?? vertical ?? "").toLowerCase();
  const combined = `${p} ${ind}`;
  if (/brand|consumer|creative director|cmo|chief marketing|campaign manager|retail|fashion|fmcg|cpg|food|beverage|lifestyle|luxury|apparel/.test(combined)) {
    return "btoc-brand";
  }
  return "btob-ops";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      batchId,
      offset: offsetParam,
      limit: limitParam,
      campaignId: campaignIdParam,
      useFastModel: useFastModelParam,
      useWebScraping: useWebScrapingParam,
      useLandingPage: useLandingPageParam,
      useVideo: useVideoParam,
      useSampleOutput: useSampleOutputParam,
      style: styleParam,
      workspaceId: workspaceIdParam,
      recycle: recycleParam,
      neverRecycledOnly: neverRecycledOnlyParam,
      oldestFirst: oldestFirstParam,
      optimizeSubject: optimizeSubjectParam,
      personas: personasParam,
      cooldownDays: cooldownDaysParam,
      providerFilter: providerFilterParam,
      judgeQuality: judgeQualityParam,
      deepResearch: deepResearchParam,
      modelOverride: modelOverrideParam,
    } = body as { batchId: string; offset?: number; limit?: number; campaignId?: string; useFastModel?: boolean; useWebScraping?: boolean; useLandingPage?: boolean; useVideo?: boolean; useSampleOutput?: boolean; style?: string; workspaceId?: string; recycle?: boolean; neverRecycledOnly?: boolean; oldestFirst?: boolean; optimizeSubject?: boolean; personas?: string[]; cooldownDays?: number; providerFilter?: string; judgeQuality?: boolean; deepResearch?: boolean; modelOverride?: string };
    // Deep per-lead WEB research (finds a real, recent hook to personally connect). Slow + costly per
    // lead, so OPT-IN (default off); callers that want it (the send path, the "write 3 now" sample) pass true.
    const useDeepResearch = deepResearchParam === true;
    // Judge quality at birth (LLM personalization + problem-first pass) unless the caller opts out. The
    // send-batch path sets this false because it runs the SAME judge at the send gate (avoid double-judging).
    const judgeQuality = judgeQualityParam !== false;

    // Auth: session for users, or CRON_SECRET + workspaceId for the autopilot orchestrator
    const cronSecret = process.env.CRON_SECRET;
    const isCron = Boolean(cronSecret && request.headers.get("x-cron-secret") === cronSecret && workspaceIdParam);
    let sessionUserId: string | null = null;
    if (!isCron) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      sessionUserId = session.user.id;
    }
    // Deep research per email is now the DEFAULT (OKR formula item #3): read the lead's site unless a
    // caller explicitly opts out. Best-effort (4s cap) and only when the lead has a website; it falls
    // back to persona pain when a site can't be read, so it never blocks generation.
    const useWebScraping = useWebScrapingParam !== false;
    const useLandingPage = useLandingPageParam === true;
    const useVideo = useVideoParam === true;
    const useSampleOutput = useSampleOutputParam === true;

    // batchId is required normally, but recycle mode may run workspace-wide (no batch) so the
    // autopilot can re-draft every eligible prior lead, not just one batch.
    if (!batchId && recycleParam !== true) {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }
    const offset = Math.max(0, Number(offsetParam) || 0);
    // Haiku + parallel: each lead ~1–2s. 10 parallel ≈ 10–15s total per chunk.
    const CHUNK_SIZE = 10;
    const limit = Math.min(CHUNK_SIZE, Math.max(1, Number(limitParam) || CHUNK_SIZE));

    const workspace = await prisma.workspace.findUnique({
      where: isCron ? { id: workspaceIdParam } : { userId: sessionUserId! },
      select: { id: true, anthropicKey: true, anthropicModel: true, productSummary: true, icp: true, proofPointsJson: true, socialProofJson: true, playbookJson: true, senderName: true, customInstructions: true, schedulingLink: true, recycleCooldownDays: true },
    });

    if (!workspace?.anthropicKey) {
      return NextResponse.json({ error: "Anthropic API key not configured." }, { status: 400 });
    }

    // When campaignId provided, use campaign's playbook/icp/proofPoints for this campaign flow
    let campaignPlaybook: string | null = null;
    let campaignIcp: string | null = null;
    let campaignProofPoints: string | null = null;
    let campaignCtaUrl: string | null = null;
    if (campaignIdParam) {
      const camp = await prisma.campaign.findFirst({
        where: { id: campaignIdParam, workspaceId: workspace.id },
        select: { playbookJson: true, icp: true, proofPointsJson: true, ctaUrl: true },
      });
      if (camp) {
        campaignPlaybook = camp.playbookJson;
        campaignIcp = camp.icp;
        campaignProofPoints = camp.proofPointsJson;
        campaignCtaUrl = camp.ctaUrl;
      }
    }

    if (batchId) {
      const batch = await prisma.leadBatch.findFirst({
        where: { id: batchId, workspaceId: workspace.id },
        select: { id: true },
      });
      if (!batch) {
        return NextResponse.json({ error: "Batch not found" }, { status: 404 });
      }
    }

    // Normal generation targets leads that have NO sequence yet. Recycle mode is the opposite:
    // it RE-writes already-sent, never-replied leads (past the cooldown, under the re-touch cap)
    // in the requested style — so the standard 8k can be re-drafted in specialist-proof for a
    // recycle send. The send path (incentives/launch useGeneratedSteps) then ships these.
    const recycle = recycleParam === true;
    // cooldownDays override (1-90): lets a targeted re-touch (e.g. the holiday swing) re-draft leads
    // sooner than the workspace default, without changing the default. Clamped so it can't go wild.
    const cooldownDays = typeof cooldownDaysParam === "number" && cooldownDaysParam >= 1 && cooldownDaysParam <= 90
      ? Math.floor(cooldownDaysParam)
      : (workspace.recycleCooldownDays ?? 21);
    const cutoff = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000);
    // Scope: one batch (manual) or the whole workspace (autopilot recycle, no batchId).
    const genScope = batchId ? { leadBatchId: batchId } : { leadBatch: { workspaceId: workspace.id } };
    const needsWorkWhere = recycle
      ? {
          ...genScope,
          sentAt: { lt: cutoff },
          suppressed: false,
          repliedAt: null,
          bouncedAt: null,
          email: { not: "" },
          // neverRecycledOnly targets the freshest-to-the-audience leads (recycleCount 0) — they've
          // only ever seen one email from us, so a hard-hitting new angle has the best shot.
          recycleCount: neverRecycledOnlyParam === true ? 0 : { lt: 2 },
          // Persona targeting — focus the swing on right-fit ICP personas (the diagnosis showed 79% of
          // the pool is unclassified and some are wrong-fit; the converters are consumer-insights/brand/
          // marketing). When provided, only re-draft leads whose persona is in this set.
          ...(Array.isArray(personasParam) && personasParam.length > 0 ? { persona: { in: personasParam } } : {}),
          // Provider targeting — only draft leads we can actually SEND to (skip strict gateways), so a
          // fresh-generate-then-send flow doesn't waste generation on unsendable recipients.
          ...(providerFilterParam === "no-gateways" ? { NOT: { emailProvider: { in: ["Microsoft", "Proofpoint", "Mimecast", "Barracuda"] } } }
            : providerFilterParam === "google" ? { OR: [{ emailProvider: "Google" }, { emailProvider: null }] } : {}),
          OR: [{ recycledAt: null }, { recycledAt: { lt: cutoff } }],
          // Don't re-draft a lead already prepared in the requested recycle style and waiting to
          // send (else we'd burn tokens rewriting the same lead each tick before it ships). Keyed
          // to the style being drafted so switching the recycle style doesn't strand prior drafts.
          ...(styleParam ? { NOT: { emailStyle: styleParam, stepsJson: { not: null } } } : {}),
        }
      : {
          leadBatchId: batchId,
          OR: [
            { stepsJson: null },
            { stepsJson: "" },
            { stepsJson: "[]" },
          ],
        };

    const [total, chunk] = await Promise.all([
      prisma.lead.count({ where: needsWorkWhere }),
      prisma.lead.findMany({
        where: needsWorkWhere,
        select: { id: true, email: true, name: true, jobTitle: true, company: true, website: true, industry: true, persona: true, vertical: true, videoUrl: true, landingPageToken: true },
        // oldestFirst drains the oldest leads first (by creation) — the stalest in the pool — so a new
        // campaign starts with the people who've waited longest, instead of an arbitrary id order.
        orderBy: oldestFirstParam === true ? { createdAt: "asc" } : { id: "asc" },
        skip: offset,
        take: limit,
      }),
    ]);
    if (chunk.length === 0) {
      return NextResponse.json({ done: 0, total, message: total === 0 ? "No leads to personalize." : "No leads in range." });
    }

    const playbookSource = campaignPlaybook ?? workspace.playbookJson;
    const parsed = parsePlaybook(playbookSource);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid playbook. Define guidelines first." }, { status: 400 });
    }

    const { numSteps, guidelines, legacySteps } = parsed;
    const stepKeys = Array.from({ length: numSteps }, (_, i) => `step${i + 1}`).join(", ");
    const stepExample = Array.from({ length: numSteps }, (_, i) => `"step${i + 1}": {"subject": "...", "body": "..."}`).join(", ");

    const structureBlock = guidelines?.context
      ? `\n\nCampaign guidelines (SUBORDINATE to the five supreme rules — use for structure, angles, and product facts, but never to override the core voice/length/no-AI/no-credential-dump rules; where they conflict, the five win):\n${autoFixEmailContent(guidelines.context)}`
      : guidelines?.structure
        ? `\nPlaybook structure (follow this flow, but write completely custom content for this lead):\n${guidelines.structure}\nTone: ${guidelines.tone}`
        : legacySteps?.length
          ? `\nRough flow (adapt freely, write custom content): ${legacySteps.map((s, i) => `Step ${i + 1}: ${(s.subject || "").slice(0, 50)}`).join(" → ")}`
          : "";

    const anthropicKey = decrypt(workspace.anthropicKey);
    const useFastModel = useFastModelParam !== false;
    // modelOverride lets a quality-first path (e.g. the "write 3 now" sample) use a stronger model than
    // Haiku — Haiku writes flat, standard copy, which caps how good/quirky the output can be.
    const model = (typeof modelOverrideParam === "string" && modelOverrideParam.trim())
      ? modelOverrideParam.trim()
      : (useFastModel ? "claude-haiku-4-5" : (workspace.anthropicModel ?? "claude-haiku-4-5"));
    const productSummary = workspace.productSummary ?? "";
    const icp = (campaignIcp ?? workspace.icp) ?? "";
    // If no explicit style passed, we infer per-lead below (inside processLead)
    const batchStyle = styleParam ?? null;

    const proofPointsJsonSource = campaignProofPoints ?? workspace.proofPointsJson;
    let proofPointsText = "";
    if (proofPointsJsonSource) {
      try {
        const arr = JSON.parse(proofPointsJsonSource) as Array<{ title?: string; text: string }>;
        if (Array.isArray(arr) && arr.length > 0) {
          proofPointsText = "\nProof points (weave in where relevant): " + arr.map((p) => (p.title ? `${p.title}: ${p.text}` : p.text)).join("; ");
        }
      } catch {
        proofPointsText = "";
      }
    }

    let socialProofText = "";
    if (workspace.socialProofJson) {
      try {
        const sp = JSON.parse(workspace.socialProofJson) as { similarCompanies?: string; referralPhrase?: string };
        const parts: string[] = [];
        if (sp.similarCompanies?.trim()) parts.push(`Similar companies using us: ${sp.similarCompanies.trim()}`);
        if (sp.referralPhrase?.trim()) parts.push(`Referral phrase (use when relevant): "${sp.referralPhrase.trim()}"`);
        if (parts.length > 0) socialProofText = "\nSocial proof (weave in naturally): " + parts.join(". ");
      } catch {
        socialProofText = "";
      }
    }

    let memory: Awaited<ReturnType<typeof getAggregatedMemory>> | null = null;
    try {
      memory = await getAggregatedMemory(workspace.id);
    } catch {
      memory = null;
    }

    const baseUrl = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

    // Self-improving engine: load active experiment variants + proven learnings once.
    // Each lead is assigned a balanced slice of active variants (for attribution) and
    // every lead inherits the proven patterns.
    let activeExperiments: Awaited<ReturnType<typeof loadActiveExperiments>> = {};
    let provenLearnings: string[] = [];
    let approvedStyles: Awaited<ReturnType<typeof loadApprovedStyles>> = {};
    try {
      [activeExperiments, provenLearnings, approvedStyles] = await Promise.all([
        loadActiveExperiments(workspace.id),
        loadLearnings(workspace.id),
        loadApprovedStyles(workspace.id),
      ]);
    } catch {
      activeExperiments = {};
      provenLearnings = [];
      approvedStyles = {};
    }
    const learningsText = learningsBlock(provenLearnings);
    // Approved operator-blessed custom styles (from the style factory). They join the static
    // STYLE_GUIDES and get a rotated slice of each batch so they accrue real reply data and get
    // reply-rated (lib/style-performance.ts). Proven styles keep the majority.
    const approvedStyleKeys = Object.keys(approvedStyles);

    // Operator's custom instructions — free-text notes (facts, an offer, preferences). SUBORDINATE to the
    // five supreme rules: use the facts/offer where they FIT, but they can NOT override the core voice,
    // length, no-AI, or no-credential-dump rules. Checks & balances: no single input flips the whole tide.
    const customInstructionsText = workspace.customInstructions?.trim()
      ? `\n\nOPERATOR NOTES (facts, offer, and preferences — weave in ONLY where they fit the five supreme rules; if a note conflicts with the core, e.g. "credential first" or a formal tone, IGNORE that part and follow the five):\n${autoFixEmailContent(workspace.customInstructions.trim())}`
      : "";

    // Link policy. Blank scheduling link = NEVER any link (stops the model inventing fake
    // Calendly URLs). Set = use that EXACT link, follow-up steps only, never step 1.
    const schedulingLink = workspace.schedulingLink?.trim() || "";
    const linkPolicy = schedulingLink
      ? `- LINK POLICY: Step 1 must contain NO links of any kind. In step 2 or later you MAY include this EXACT booking link, unchanged, and no other URL: ${schedulingLink}\n- Never invent, guess, shorten, or alter any link. Do not fabricate a Calendly or any other URL — only the exact link above is allowed.`
      : `- LINK POLICY: Reply-first. NEVER include any link, URL, or scheduling link in ANY step. Do not write or invent a Calendly, website, or booking URL anywhere. The only call to action is to reply.`;

    const processLead = async (lead: (typeof chunk)[0], leadIndex: number) => {
      // Resolve style: explicit batch style → approved-style rotation (~1 in 6 of un-pinned leads) →
      // inferred from persona/industry → direct-ask fallback.
      let resolvedStyle = batchStyle ?? inferStyle(lead.persona, lead.industry, lead.vertical);
      if (!batchStyle && approvedStyleKeys.length > 0 && leadIndex % 6 === 5) {
        resolvedStyle = approvedStyleKeys[Math.floor(leadIndex / 6) % approvedStyleKeys.length];
      }
      const styleConfig = STYLE_GUIDES[resolvedStyle] ?? approvedStyles[resolvedStyle] ?? STYLE_GUIDES["direct-ask"];
      const usePS = styleConfig.usePS;

      // Quirky styles A/B eight radical SUBJECT MECHANISMS — rotate one per lead, inject it, tag the lead.
      const isQuirky = ["quirky-incentive", "outcome-hook", "curiosity-gap"].includes(resolvedStyle);
      const mechanism = isQuirky ? mechanismForIndex(leadIndex) : null;

      // specialist-proof carries a gift-for-demo, and we VARY the amount per lead
      // (like the Incentives Lab) so Results' offer A/B reveals which gift converts.
      const GIFT_AMOUNTS = [50, 100, 200];
      const GIFT_TYPES = ["Uber Eats card", "DoorDash card", "Amazon gift card"];
      const useGift = resolvedStyle === "specialist-proof" || resolvedStyle === "direct-incentive" || resolvedStyle === "holiday-incentive" || resolvedStyle === "founder-incentive" || resolvedStyle === "outcome-hook" || resolvedStyle === "quirky-incentive";
      const giftAmount = useGift ? GIFT_AMOUNTS[leadIndex % GIFT_AMOUNTS.length] : null;
      const giftType = useGift ? GIFT_TYPES[Math.floor(leadIndex / GIFT_AMOUNTS.length) % GIFT_TYPES.length] : null;
      const giftBlock = useGift
        ? `\n\nGIFT FOR THIS SEQUENCE (use this exact gift, it is the [GIFT] placeholder): a $${giftAmount} ${giftType}. Do not change the amount or invent a different one.
GIFT CONTINUITY (critical — the steps are ONE ongoing thread, not separate emails the reader sees fresh):
- The money must be INTRODUCED in step 1, stated plainly the first time, e.g. "I'll put a $${giftAmount} ${giftType} behind a 20-minute demo."
- In step 2+ you may bring the gift back ONLY as a callback to the step-1 offer, with language that assumes it was already made, e.g. "the $${giftAmount} ${giftType} still stands" or "that $${giftAmount} ${giftType} is still yours if you book."
- NEVER use callback words like "still", "still stands", or "still yours" the FIRST time money appears. If the gift was not in step 1 and you introduce it in a later step, frame it as a NEW offer ("I'll add a $${giftAmount} ${giftType} for 20 minutes"), never as a reminder of something never offered. Saying "still yours" about money the reader was never offered reads as broken and discontinuous.
- Use the exact same amount and gift type every time it is referenced. Never imply a different, earlier, or larger amount.`
        : "";

      // Assign this lead a balanced set of active experiment variants for attribution
      const { ids: experimentIds, block: experimentBlock } = assignExperiments(activeExperiments, leadIndex);

      // ~10% of leads get a deliberately RADICAL wildcard approach (spread across many
      // styles) to discover whether any unconventional angle breaks through when the
      // standard approach is getting near-zero replies. Recorded per-lead for tracking.
      const wildcard = pickWildcard(lead.email);
      const wildcardBlock = wildcard
        ? `\n\n=== RADICAL APPROACH OVERRIDE (highest priority — follow this over the standard structure above) ===\nWe are testing bold, unconventional emails to find what breaks through. For THIS email, use this approach:\n${wildcard.instruction}\nStill obey the hard rules: no links in step 1, no em dashes, no AI-sounding words, prose only, keep the sign-off rule below. Each step still needs a real subject (>=10 chars) and a body of at least 2 short sentences. But otherwise be genuinely bold and different from a normal cold email.`
        : "";

      // Style-specific sign-off: direct-ask uses first name only (brevity = credibility);
      // other styles append the company name for a light authority signal
      const senderFirstName = workspace.senderName?.trim().split(/\s+/)[0] ?? "Best";
      const signoff = (resolvedStyle === "direct-ask" || resolvedStyle === "direct-incentive" || resolvedStyle === "holiday-incentive" || resolvedStyle === "founder" || resolvedStyle === "founder-incentive" || resolvedStyle === "outcome-hook" || resolvedStyle === "curiosity-gap" || resolvedStyle === "quirky-incentive")
        ? senderFirstName
        : `${senderFirstName}, Gather`;

      // Similar-brand proof: pick the ONE Gather customer that actually looks like this lead and
      // lead with it ("a brand like you already does this"), instead of the generic 4-logo stack.
      // social-proof style may stack a same-family second name; every other style uses exactly one.
      const brandProofText = brandProofBlock(
        { company: lead.company, industry: lead.industry, vertical: lead.vertical, persona: lead.persona },
        { allowStack: resolvedStyle === "social-proof" }
      );

      // Detect B2C brand register so language can shift from ROI/efficiency to craft/quality
      const register = inferRegister(lead.persona, lead.industry, lead.vertical);
      const registerBlock = register === "btoc-brand"
        ? `\nAUDIENCE REGISTER: This person works on consumer brands. They think in creative quality, brand voice, and audience resonance — NOT efficiency metrics, ROI, or pipeline. Frame everything around craft, creative speed, and brand consistency. Avoid: "scale", "ROI", "pipeline", "workflow", "streamline". Use: "campaign", "brief", "brand voice", "creative direction", "audience".`
        : "";

      // Build stable system prompt per style (cached by Anthropic per unique prompt text)
      const systemPrompt = `You are an expert B2B cold email writer for ${workspace.senderName ?? "the sender"}.

${REPLY_FORMULA}

PRODUCT:
${productSummary}

IDEAL CUSTOMER PROFILE:
${icp}${proofPointsText}${socialProofText}${structureBlock}${registerBlock}

MAKE THEM CARE (most important — this decides whether the email works):
- Lead with THEIR world, not the product. Open on a real tension this person feels in their job right now, then show the specific shift the product makes possible. Sell the outcome and the speed, never a feature list.
- Be concrete with proof. Every proof point is a real customer name plus a specific, tangible result. Never "companies like yours", never vague claims. Name-drop a recognizable customer when it fits the recipient (a consumer brand for a B2C marketer, an enterprise for a tech marketer).
- One idea per email. If they remember one sentence, it should be the transformation, not your company name.

STEP JOBS — each step has one specific job, do not blur them:
- Step 1: Earn the demo ask through the email itself. Open in their world (a pain or a sharp insight), then make the transformation obvious. Close with a short conditional demo invite that feels like the natural next step, not a pitch. No links.
- Step 2: Reinforce with proof. Lead with one real proof point (customer name + specific result), then repeat the demo ask directly. Follow the LINK POLICY below for whether a booking link is allowed.
- Step 3: Pattern interrupt or graceful exit. Either a completely fresh angle in under 60 words, or a genuine breakup — e.g. "Happy to leave you alone if the timing isn't right — just say the word."

EMAIL RULES:
- Subject line: SHORT — aim for 1–4 lowercase words (proper nouns aside), anchored to their world. No clickbait, no ALL CAPS, no sell. (Data: under-4-word subjects reply 4.2x higher than long ones.)
- Step 1 body: 3 short lines, a hard maximum of ${MAX_BODY_WORDS} words — a few tight lines, NEVER an indigestible block. Cut words before you exceed this.
${linkPolicy}
${usePS ? `- Include a P.S. line in step 1 — reference something real and specific about them (recent launch, campaign, hire, news)` : `- Do NOT include a P.S. line — the style requires a clean ending`}
- Steps 2+ must NOT open with a greeting — they thread as inbox replies (Re: subject)
- Never use exclamation marks, jargon, or generic claims like "I came across your profile"
- NEVER use em dashes (—) or en dashes (–) anywhere in the email
- Avoid words that signal AI authorship: "delve", "leverage", "utilize", "ensure", "streamline", "game-changer", "seamlessly", "revolutionize", "cutting-edge", "robust", "comprehensive", "holistic", "empower", "unlock", "transformative"
- Avoid semicolons — use short sentences instead
- Write as a human peer, not a marketer
- Sign off every email with the SENDER'S name (yours), never the recipient's name. Use exactly: ${signoff}

${styleConfig.prompt}${researchPlaybookBlock()}${brandProofText}${learningsText}${experimentBlock}${customInstructionsText}${giftBlock}${wildcardBlock}${
  mechanism
    ? `\n\n*** SUBJECT OVERRIDE (highest priority — ignore any earlier rule to keep the subject plain/lowercase/1-4-words/no-emoji/no-clickbait) ***\nThe subject MUST be captivating and grab a marketing director. Do NOT write a plain descriptive subject like "[company]'s creative testing" — that defeats the whole test.${subjectMechanismBlock(mechanism)}`
    : ""
}`;
      let companyContextBlock = "";
      let companyContextRaw: string | null = null;
      if (useWebScraping && lead.website?.trim()) {
        const scraped = await scrapeForContext(lead.website.trim());
        if (scraped) {
          companyContextRaw = scraped;
          // Extract structured trigger signals rather than dumping raw text
          companyContextBlock = `\n\nCompany context (scraped from their site):\n${scraped}\n\nTRIGGER INSTRUCTION: Before writing step 1, identify the single most specific signal in the company context above — a recent product launch, a new campaign, an expansion, a hiring trend, a press mention, a specific brand positioning statement. Open step 1 by referencing this signal so the email feels timely and researched, not generic. If no clear trigger exists, use the strongest persona pain point instead.`;
        }
      } else if (useLandingPage && lead.website?.trim()) {
        // Always scrape for LP research even if useWebScraping is off
        const scraped = await scrapeForContext(lead.website.trim());
        if (scraped) companyContextRaw = scraped;
      }

      // Deep web research — the real "connect on a personal level" step. Live web search per lead for a
      // recent, specific hook (a post, a launch, a funding round, a hire, the phase their brand is in).
      // Slow + costly; opt-in. Best-effort — null (nothing real found / call failed) falls back to the scrape.
      // Give the researcher Gather's real capabilities + proof so it picks the signal WE can best speak to.
      const gatherForResearch = [productSummary, proofPointsText, socialProofText].filter(Boolean).join("\n").slice(0, 1500) || null;
      const deepResearch = useDeepResearch
        ? await deepResearchLead(anthropicKey, { name: lead.name, jobTitle: lead.jobTitle, company: lead.company, website: lead.website, industry: lead.industry }, model, companyContextRaw, gatherForResearch)
        : null;
      const deepResearchText = deepResearchBlock(deepResearch);
      // Avoid two competing "open sentence 1 on this" instructions: when deep research found a real hook,
      // that hook is THE opener and the scraped site text becomes background context only.
      const contextForPrompt = deepResearch
        ? (companyContextRaw ? `\n\nBackground on their company (context only — your opener is the researched hook above, don't open on this):\n${companyContextRaw.slice(0, 1200)}` : "")
        : companyContextBlock;

      let videoBlock = "";
      if (useVideo && lead.videoUrl?.trim()) {
        videoBlock = `\n\nInclude this personalized video link in at least one email: ${lead.videoUrl}. Write a compelling reason for them to watch (e.g. "I recorded a quick video for you" or "Here's a 5-second clip I made for [Company]").`;
      }

      let landingPageBlock = "";
      let landingPageToken: string | null = null;
      if (useLandingPage && baseUrl) {
        landingPageToken = lead.landingPageToken ?? randomUUID();
        const lpUrl = `${baseUrl.replace(/\/$/, "")}/lp/${landingPageToken}`;

        // 1. Research phase — synthesize insights from lead data + scraped content
        const research = await generateLeadResearch(
          {
            name: lead.name,
            jobTitle: lead.jobTitle,
            company: lead.company,
            industry: lead.industry,
            website: lead.website,
            websiteText: companyContextRaw ?? null,
            productSummary,
            icp,
          },
          anthropicKey,
          model
        );

        // 2. Landing page content gen — calls Claude + synthetic MCP
        const senderNameStr = workspace.senderName?.trim() || "The team";
        const socialProofStr = (() => {
          try {
            if (!workspace.socialProofJson) return "";
            const sp = JSON.parse(workspace.socialProofJson) as { similarCompanies?: string; referralPhrase?: string };
            return [sp.similarCompanies, sp.referralPhrase].filter(Boolean).join(". ");
          } catch { return ""; }
        })();
        const lpContent = await generateLandingPageContent(
          {
            name: lead.name,
            jobTitle: lead.jobTitle,
            company: lead.company,
            industry: lead.industry,
            research,
            productSummary,
            senderName: senderNameStr,
            socialProof: socialProofStr,
            ctaUrl: campaignCtaUrl ?? "",
          },
          anthropicKey
        );

        // 3. Build rich email block that references actual page content
        landingPageBlock = landingPageContentForEmailPrompt(lpContent, lpUrl);

        // Store content on lead for page rendering
        const lpContentJson = JSON.stringify(lpContent);
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            landingPageToken,
            landingPageContentJson: lpContentJson,
          },
        });
      }

      let strategyBlock = "";
      if (memory && (lead.persona || lead.vertical)) {
        const parts: string[] = [];
        const instructions: string[] = [];
        if (lead.persona && memory.byPersona[lead.persona]) {
          const p = memory.byPersona[lead.persona];
          const posReplies = p.positive_reply_count ?? 0;
          const objections = p.objection_count ?? 0;
          const openRate = p.open_rate_pct_avg ?? 0;
          parts.push(`Persona "${lead.persona}": ${posReplies} positive replies, ${objections} objections (open rate ${openRate}% — weak signal, no links so opens are unreliable)`);
          if (posReplies > 0) {
            instructions.push(`"${lead.persona}" is converting (${posReplies} positive replies) — reuse the angles and proof that have worked for this persona.`);
          } else if (objections >= 3) {
            instructions.push(`"${lead.persona}" replies but objects (${objections} objections, 0 positives) — change the offer or reason-to-reply, not just the subject line.`);
          }
        }
        if (lead.vertical && memory.byVertical[lead.vertical]) {
          const v = memory.byVertical[lead.vertical];
          const posReplies = v.positive_reply_count ?? 0;
          parts.push(`Vertical "${lead.vertical}": ${posReplies} positive replies`);
          if (posReplies > 0) {
            instructions.push(`Vertical "${lead.vertical}" converts — emphasize the value and proof that resonate with this segment.`);
          }
        }
        if (parts.length > 0) {
          strategyBlock = "\n\nPerformance data for this segment: " + parts.join("; ");
          if (instructions.length > 0) {
            strategyBlock += "\n\nAPPLY these learnings: " + instructions.join(" ");
          } else {
            strategyBlock += "\n\nUse this to tailor tone, subject lines, and emphasis.";
          }
        }
      }

      // Show-don't-tell: generate a sample Gather output for their brand (optional, adds one Claude call)
      // Included in step 2 so the product demonstrates itself on their material before the demo ask
      let sampleOutputBlock = "";
      if (useSampleOutput && (lead.company || lead.industry)) {
        try {
          const samplePrompt = `You are Gather AI. Write ONE example of what you would produce for ${lead.company ?? "this company"} (${lead.jobTitle ? `a ${lead.jobTitle}` : ""} in ${lead.industry ?? "their industry"}): a 2-sentence campaign brief or creative direction note that sounds like it was written by someone who deeply knows their brand. Be specific, confident, and creative — not generic. Return only the sample text, no intro, no explanation.`;
          const { text: sample } = await callAnthropic(anthropicKey, samplePrompt, { maxTokens: 120, model });
          if (sample.trim()) {
            sampleOutputBlock = `\n\nSHOW-DON'T-TELL: In step 2, after the proof point, include this sample of what Gather would produce for their brand — present it naturally, e.g. "Here's an example of how Gather would brief a ${lead.company ?? "your"} campaign:" — then the sample. This demonstrates the product on their material. Sample: "${sample.trim()}"`;
          }
        } catch {
          // non-fatal — skip if the extra call fails
        }
      }

      const userMessage = `Write a ${numSteps}-step hyper-personalized cold email sequence for this lead. Make it feel 1:1 — completely custom, not a template.${strategyBlock}

LEAD:
- Name: ${lead.name ?? "unknown"}
- Title: ${lead.jobTitle ?? "unknown"}
- Company: ${lead.company ?? "unknown"}
- Industry: ${lead.industry ?? "unknown"}${lead.website ? `\n- Website: ${lead.website}` : ""}${lead.persona || lead.vertical ? `\n- Persona: ${lead.persona ?? ""} | Vertical: ${lead.vertical ?? ""}` : ""}${deepResearchText}${contextForPrompt}${videoBlock}${landingPageBlock}${sampleOutputBlock}

Use their real name/company throughout. Do NOT use {{placeholders}}.
Greet as: "Hi ${(lead.name ?? "there").split(/\s+/)[0] || "there"},"
Steps 2+ subject must start with "Re: " + step 1 subject.

Return ONLY valid JSON: { ${stepExample} }`;

      let usage = { input_tokens: 0, output_tokens: 0 };
      try {
        const { text: raw, usage: u } = await callAnthropic(anthropicKey, userMessage, { maxTokens: 4000, model, systemPrompt });
        if (u) usage = u;
        let jsonStr = raw.trim();
        const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlock) jsonStr = codeBlock[1].trim();
        const parsed = JSON.parse(jsonStr) as Record<string, { subject?: string; body?: string }>;

        const stepsArray = Array.from({ length: numSteps }, (_, i) => {
          const key = `step${i + 1}`;
          const step = parsed[key];
          const s = typeof step === "object" && step ? step : {};
          return {
            subject: (s.subject ?? "").trim(),
            body: (s.body ?? "").trim(),
          };
        });

        // Validate — if step1 subject is empty, throw so catch block retries rather than saving garbage
        if (!stepsArray[0]?.subject?.trim()) {
          throw new Error(`Claude returned empty step1 subject. Raw: ${raw.slice(0, 300)}`);
        }

        // Auto-fix em dashes (hard rule — always clean)
        for (const step of stepsArray) {
          step.subject = autoFixEmailContent(step.subject);
          step.body = autoFixEmailContent(step.body);
        }

        // Quality check — log violations but do not block (auto-fix handles the worst offenders)
        const { violations, hasViolations } = validateEmailSteps(stepsArray);
        if (hasViolations) {
          const summary = violations.map((v) => `step${v.step} ${v.field}: ${v.issues.map((i) => i.detail).join(", ")}`).join(" | ");
          console.warn(`[generate] Email quality violations for lead ${lead.id}: ${summary}`);
          // Log as activity so operator can see it on the activity page
          logActivity(workspace.id, "info",
            `Quality warning: ${violations.length} issue(s) in generated email for ${lead.company ?? lead.email}`,
            { leadId: lead.id, violations: summary.slice(0, 500) }
          ).catch(() => {});
        }

        // Auto-shorten any step body over the punchy limit — make it SHORT and PUNCHY, not just under a cap.
        for (const step of stepsArray) {
          if (wordCount(step.body) > MAX_BODY_WORDS) {
            try {
              const { text: shortened } = await callAnthropic(
                anthropicKey,
                `Rewrite this cold email to 3 short lines, UNDER ${PUNCHY_TARGET_WORDS} words. KEEP the deep personalization — the specific, real detail about THIS company/person must stay. Structure: line 1 = that specific personal read on them; line 2 = the one proof-of-outcome (a brand like them + what they got); line 3 = the one reply-first ask (keep any gift amount exactly). Delete every hedge, extra clause, and explanation — but never delete the personal detail or turn it generic. Keep the greeting. Return only the rewritten body, no commentary:\n\n${step.body}`,
                { maxTokens: 220, model }
              );
              if (shortened.trim()) step.body = shortened.trim();
            } catch {
              // keep original if shorten fails
            }
          }
        }

        // Quality grade (deterministic, free) on step 1 — the email that earns the reply. If it
        // doesn't clear the research-backed bar, regenerate step 1 ONCE with the specific fixes and
        // keep whichever scores higher. This is the "are the emails good?" gate, enforced pre-send.
        let grade = gradeEmail(stepsArray[0], { company: lead.company });
        let step1Regenerated = false;
        if (!grade.pass && grade.fixes.length > 0) {
          try {
            const fixPrompt = `${userMessage}\n\nYOUR PREVIOUS step1 scored ${grade.score}/100 and must be sharper. Fix these specific issues, keep everything else strong:\n${grade.fixes.map((f) => `- ${f}`).join("\n")}\n\nReturn ONLY valid JSON for step1: { "step1": { "subject": "...", "body": "..." } }`;
            const { text: fixRaw } = await callAnthropic(anthropicKey, fixPrompt, { maxTokens: 800, model, systemPrompt });
            const fixJson = fixRaw.slice(fixRaw.indexOf("{"), fixRaw.lastIndexOf("}") + 1);
            const reParsed = JSON.parse(fixJson) as Record<string, { subject?: string; body?: string }>;
            const s1 = reParsed.step1;
            if (s1?.subject && s1?.body) {
              const revised = { subject: autoFixEmailContent(s1.subject.trim()), body: autoFixEmailContent(s1.body.trim()) };
              const revisedGrade = gradeEmail(revised, { company: lead.company });
              if (revisedGrade.score > grade.score) {
                stepsArray[0] = revised;
                grade = revisedGrade;
                step1Regenerated = true;
              }
            }
          } catch {
            // keep the original if the revision call fails
          }
        }

        // Quality JUDGE at birth (LLM) — the deep-personalization + problem-first check a regex can't see,
        // so a fresh email is GOOD when written, not written-then-rejected at the send gate. One judge call;
        // one targeted regen if it's generic or solution-first. Best-effort — never blocks generation.
        let judgeScores: { p: number; pf: number; sh: number; hu: number } | null = null;
        if (judgeQuality) {
          try {
            const verdict = await judgeEmailContent(anthropicKey, stepsArray[0], { company: lead.company, persona: lead.persona, product: productSummary }, model);
            if (verdict) judgeScores = { p: verdict.personalizationScore, pf: verdict.problemFirstScore, sh: verdict.subjectHookScore, hu: verdict.humanScore };
            if (verdict && (verdict.cringeScore < 60 || verdict.humanScore < 60 || verdict.personalizationScore < 55 || (verdict.problemFirstScore + verdict.subjectHookScore) < 90)) {
              const jfixes = verdict.fixes.length ? verdict.fixes : ["Rewrite so it reads like a real person genuinely reaching out. Open with a SPECIFIC, real read on this company, lead with the problem they feel + the ROI, then the matched proof, then one reply-first ask."];
              const jf = `${userMessage}\n\nA reply-rate judge scored your step1 — cringe-free ${verdict.cringeScore}/100, human/real-person ${verdict.humanScore}/100, personalization ${verdict.personalizationScore}/100, problem+ROI ${verdict.problemFirstScore}/100, subject-hook ${verdict.subjectHookScore}/100. Fixes: make it feel like a REAL person genuinely reaching out to help THIS person (natural voice, contractions, personality); strip anything template/AI. Kill EVERY cringe cliché — no "worth a reply?", "worth 15 minutes?", "hop on a call", "pick your brain", "let's connect", forced enthusiasm. Make the ask sound like a real person (e.g. "want me to send the [specific thing]?" / "should I send it over?" / a question tied to the value). Inviting subject (a concrete value-exchange like "$50 for 3 minutes", a sharp number, or a curiosity gap; never "quick question"). Lead with their problem + the ROI. Body: 3 short lines under ${MAX_BODY_WORDS} words:\n${jfixes.map((f) => `- ${f}`).join("\n")}\n\nReturn ONLY valid JSON for step1: { "step1": { "subject": "...", "body": "..." } }`;
              const { text: jr } = await callAnthropic(anthropicKey, jf, { maxTokens: 800, model, systemPrompt });
              const jj = JSON.parse(jr.slice(jr.indexOf("{"), jr.lastIndexOf("}") + 1)) as Record<string, { subject?: string; body?: string }>;
              const s1 = jj.step1;
              if (s1?.subject && s1?.body) {
                const revised = { subject: autoFixEmailContent(s1.subject.trim()), body: autoFixEmailContent(s1.body.trim()) };
                // Accept only if it stays sendable-length and doesn't regress the deterministic craft score;
                // the send-gate judge is the final arbiter, so a best-effort improvement here is enough.
                const revisedGrade = gradeEmail(revised, { company: lead.company });
                if (wordCount(revised.body) <= MAX_BODY_WORDS + 5 && revisedGrade.score >= grade.score - 3) {
                  stepsArray[0] = revised;
                  grade = revisedGrade;
                  step1Regenerated = true;
                }
              }
            }
          } catch {
            // judge is best-effort — never block generation on it
          }
        }

        // Subject optimization (opt-in, e.g. hit-oldest): the subject is the open-gate. Generate a few
        // personalized, signal-based candidates and swap in the best one if it beats the drafted subject.
        // Step 2+ subjects stay "Re: <step1>" so the thread holds.
        if (optimizeSubjectParam === true) {
          try {
            const cands = await generateSubjectCandidates(
              anthropicKey, model,
              { name: lead.name, company: lead.company, jobTitle: lead.jobTitle, industry: lead.industry },
              { product: productSummary, styleHint: resolvedStyle, bodyHint: stepsArray[0].body },
              6
            );
            const best = cands[0];
            if (best && best.score > scoreSubject(stepsArray[0].subject, { company: lead.company, firstName: (lead.name ?? "").split(/\s+/)[0] || null }).score) {
              const prevSubject = stepsArray[0].subject;
              stepsArray[0].subject = autoFixEmailContent(best.subject);
              // keep Re: threading on later steps pointed at the NEW subject
              for (let i = 1; i < stepsArray.length; i++) {
                if (/^re:\s*/i.test(stepsArray[i].subject) || stepsArray[i].subject.includes(prevSubject)) {
                  stepsArray[i].subject = `Re: ${stepsArray[0].subject}`;
                }
              }
            }
          } catch {
            // keep the generated subject if optimization fails
          }
        }

        // FINAL LENGTH GUARANTEE — after every regen/edit, no step may be saved over the ceiling. The
        // earlier shortener is best-effort (a failed call leaves a long body); this is the hard backstop so
        // generation never produces a long, indigestible draft. Retries once, then hard-trims by sentence.
        for (const step of stepsArray) {
          if (wordCount(step.body) <= MAX_BODY_WORDS) continue;
          try {
            const { text: reShort } = await callAnthropic(
              anthropicKey,
              `Rewrite to UNDER ${PUNCHY_TARGET_WORDS} words, 3 short lines: the specific personal read, the problem+proof, the ask (keep any gift $ and greeting). No cringe CTAs. Return only the body:\n\n${step.body}`,
              { maxTokens: 200, model }
            );
            const cut = autoFixEmailContent((reShort || "").trim());
            if (cut && wordCount(cut) < wordCount(step.body)) step.body = cut;
          } catch { /* fall through to hard trim */ }
          // Still too long → hard-trim to the first sentences that fit the ceiling (never save a block).
          if (wordCount(step.body) > MAX_BODY_WORDS) {
            const sents = step.body.split(/(?<=[.!?])\s+/);
            let out = "";
            for (const s of sents) { if (wordCount(out + " " + s) > MAX_BODY_WORDS) break; out = (out ? out + " " : "") + s; }
            step.body = (out || step.body.split(/\s+/).slice(0, MAX_BODY_WORDS).join(" ")).trim();
          }
        }

        const update: Record<string, string | number | null> = {
          stepsJson: JSON.stringify(stepsArray),
          emailStyle: resolvedStyle, // always save — inferred or explicit
          experimentIdsJson: experimentIds.length > 0 ? JSON.stringify(experimentIds) : null, // for variant attribution
          wildcardApproach: wildcard?.label ?? null, // radical-approach tracking (null = standard)
        };
        update.step1Subject = stepsArray[0].subject || null;
        update.step1Body = stepsArray[0].body || null;
        if (stepsArray[1]) {
          update.step2Subject = stepsArray[1].subject || null;
          update.step2Body = stepsArray[1].body || null;
        }
        if (stepsArray[2]) {
          update.step3Subject = stepsArray[2].subject || null;
          update.step3Body = stepsArray[2].body || null;
        }

        if (useGift && giftAmount) { update.incentiveAmount = giftAmount; update.incentiveGiftType = giftType; }
        // Tag the subject mechanism so reply rate is measured per mechanism (survives the send).
        if (mechanism) update.incentiveSubjectStyle = `${MECHANISM_TAG_PREFIX}${mechanism.key}`;
        await prisma.lead.update({
          where: { id: lead.id },
          data: update,
        });
        return { leadId: lead.id, usage, gradeScore: grade.score, step1Regenerated, judge: judgeScores };
      } catch (err) {
        console.error(`Lead ${lead.id} personalize error:`, err instanceof Error ? err.message : err);
        return { leadId: lead.id, usage, gradeScore: null as number | null, step1Regenerated: false, judge: null as { p: number; pf: number; sh: number; hu: number } | null };
      }
    };

    // Process with limited concurrency to avoid exhausting DB connection pool
    // Claude API calls can be parallel but DB writes need to be controlled
    const CONCURRENCY = 5;
    const results: Array<{ leadId: string; usage: { input_tokens: number; output_tokens: number }; gradeScore?: number | null; step1Regenerated?: boolean; judge?: { p: number; pf: number; sh: number; hu: number } | null }> = [];
    for (let i = 0; i < chunk.length; i += CONCURRENCY) {
      const batch = chunk.slice(i, i + CONCURRENCY);
      // Global index (offset + position) keeps experiment round-robin balanced across chunks
      const batchResults = await Promise.all(batch.map((lead, j) => processLead(lead, offset + i + j)));
      results.push(...batchResults);
    }
    const leadIds = results.map((r) => r.leadId);
    const usageTotal = results.reduce(
      (acc, r) => ({
        input_tokens: acc.input_tokens + r.usage.input_tokens,
        output_tokens: acc.output_tokens + r.usage.output_tokens,
      }),
      { input_tokens: 0, output_tokens: 0 }
    );

    // Quality telemetry — average grade across the batch + how many needed a step-1 rewrite. Lets the
    // loop see whether the emails are actually GOOD trending over time, not just that they got sent.
    const graded = results.map((r) => r.gradeScore).filter((s): s is number => typeof s === "number");
    const avgGrade = graded.length > 0 ? Math.round(graded.reduce((a, b) => a + b, 0) / graded.length) : null;
    const regenerated = results.filter((r) => r.step1Regenerated).length;
    // First-draft judge averages (personalization / problem-first / subject-hook) — visibility into whether
    // the generated emails actually clear the send-gate floors, so quality isn't a black box.
    const judged = results.map((r) => r.judge).filter((j): j is { p: number; pf: number; sh: number; hu: number } => !!j);
    const avgJudge = judged.length > 0 ? {
      human: Math.round(judged.reduce((a, j) => a + j.hu, 0) / judged.length),
      personalization: Math.round(judged.reduce((a, j) => a + j.p, 0) / judged.length),
      problemFirst: Math.round(judged.reduce((a, j) => a + j.pf, 0) / judged.length),
      subjectHook: Math.round(judged.reduce((a, j) => a + j.sh, 0) / judged.length),
    } : null;

    await logActivity(workspace.id, "generate",
      `Generated ${chunk.length} email sequence${chunk.length === 1 ? "" : "s"} (${numSteps} steps each)${avgGrade !== null ? ` — avg quality ${avgGrade}/100${regenerated > 0 ? `, ${regenerated} auto-rewritten` : ""}` : ""} — ${total - chunk.length} remain`,
      {
        generated: chunk.length,
        remaining: Math.max(0, total - chunk.length),
        steps: numSteps,
        batchId,
        avgGrade,
        regenerated,
        ...(avgJudge ? { avgJudge } : {}),
        ...(usageTotal.input_tokens > 0 ? { input_tokens: usageTotal.input_tokens, output_tokens: usageTotal.output_tokens } : {}),
      }
    );

    return NextResponse.json({
      done: chunk.length,
      total,
      leadIds,
      avgGrade,
      avgJudge,
      usage: usageTotal.input_tokens > 0 || usageTotal.output_tokens > 0 ? usageTotal : undefined,
      message: `Personalized ${chunk.length} lead(s), ${numSteps} steps each.`,
    });
  } catch (error: any) {
    console.error("Leads generate error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
