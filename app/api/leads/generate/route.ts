import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { callAnthropic } from "@/lib/anthropic";
import { getAggregatedMemory } from "@/lib/performance-memory";
import { parsePlaybook } from "@/lib/playbook";
import { scrapeForContext } from "@/lib/scrape";
import { generateLeadResearch } from "@/lib/research";
import { generateLandingPageContent, landingPageContentForEmailPrompt } from "@/lib/lp-content-gen";
import { randomUUID } from "crypto";

// Allow up to 60s so a few Anthropic calls can finish (Vercel Pro; Hobby may still cap at 10s)
export const maxDuration = 60;

const MAX_BODY_WORDS = 150;

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
Include a P.S. that references something real and specific about them — a recent campaign, a hire, a product launch.`,
  },

  "insight-hook": {
    usePS: false,
    prompt: `EMAIL STYLE: Insight-Hook
Open with a surprising, specific data point or industry observation they likely haven't seen.
The insight should connect directly to a problem your product solves.
Subject line: lead with the data or observation, e.g. "67% of brand teams miss this" or "What Nike changed in Q1".
No P.S. — the hook should be strong enough on its own. Keep it punchy.`,
  },

  "social-proof": {
    usePS: true,
    prompt: `EMAIL STYLE: Social-Proof
Open by referencing a recognisable brand, result, or name the reader will respect.
Let the proof do the work — they should think "if it works for them, it could work for us."
Subject line: name-drop the proof point, e.g. "How [Brand] cut agency spend 40%" or "What [Company] is doing differently".
Include a P.S. that reinforces credibility — another proof point, a stat, or a relevant quote.`,
  },

  "direct-ask": {
    usePS: false,
    prompt: `EMAIL STYLE: Direct-Ask
No warm-up. Shortest path to the ask.
One sentence on what you do. One sentence on why it matters to them specifically. One ask.
Confident peer-to-peer tone — write like a colleague, not a vendor.
Subject line: ultra-short and direct, e.g. "Quick question" or "[Company] + Gather".
No P.S. — adding one undermines the directness. Keep the whole email under 80 words.`,
  },
};

/**
 * Auto-assign an email style based on persona + industry when no explicit style is passed.
 * Logic: analytical roles → insight-hook, exec/brand → social-proof, ops/agency → pain-led, default → direct-ask
 */
function inferStyle(persona?: string | null, industry?: string | null, vertical?: string | null): string {
  const p = (persona ?? "").toLowerCase();
  const ind = (industry ?? vertical ?? "").toLowerCase();

  // C-suite and VPs respond well to social proof (peer validation)
  if (/cmo|ceo|cfo|chief|vp |vice president/.test(p)) return "social-proof";

  // Analytical roles (data, product, strategy) respond to insight-hook
  if (/analyst|data|product|strategy|insight|research/.test(p)) return "insight-hook";

  // Brand/marketing/content managers respond to social proof
  if (/brand|content|creative|marketing manager|campaign/.test(p)) return "social-proof";

  // Operations, agency, and growth roles respond to pain-led
  if (/operat|agency|growth|demand|lead gen|sdr|bdr/.test(p)) return "pain-led";

  // Industry signals
  if (/agency|consult|pr firm/.test(ind)) return "pain-led";
  if (/tech|saas|software|fintech/.test(ind)) return "insight-hook";
  if (/retail|consumer|fmcg|cpg|fashion|food/.test(ind)) return "social-proof";

  // Default
  return "direct-ask";
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
      style: styleParam,
    } = body as { batchId: string; offset?: number; limit?: number; campaignId?: string; useFastModel?: boolean; useWebScraping?: boolean; useLandingPage?: boolean; useVideo?: boolean; style?: string };
    const useWebScraping = useWebScrapingParam === true;
    const useLandingPage = useLandingPageParam === true;
    const useVideo = useVideoParam === true;

    if (!batchId) {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }
    const offset = Math.max(0, Number(offsetParam) || 0);
    // Haiku + parallel: each lead ~1–2s. 10 parallel ≈ 10–15s total per chunk.
    const CHUNK_SIZE = 10;
    const limit = Math.min(CHUNK_SIZE, Math.max(1, Number(limitParam) || CHUNK_SIZE));

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, anthropicKey: true, anthropicModel: true, productSummary: true, icp: true, proofPointsJson: true, socialProofJson: true, playbookJson: true, senderName: true },
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

    const batch = await prisma.leadBatch.findFirst({
      where: { id: batchId, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const needsWorkWhere = {
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
        orderBy: { id: "asc" },
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
      ? `\n\nCampaign context & guidelines (use to shape every email — tone, angles, product framing, any URLs or research notes provided):\n${guidelines.context}`
      : guidelines?.structure
        ? `\nPlaybook structure (follow this flow, but write completely custom content for this lead):\n${guidelines.structure}\nTone: ${guidelines.tone}`
        : legacySteps?.length
          ? `\nRough flow (adapt freely, write custom content): ${legacySteps.map((s, i) => `Step ${i + 1}: ${(s.subject || "").slice(0, 50)}`).join(" → ")}`
          : "";

    const anthropicKey = decrypt(workspace.anthropicKey);
    const useFastModel = useFastModelParam !== false;
    const model = useFastModel ? "claude-haiku-4-5" : (workspace.anthropicModel ?? "claude-haiku-4-5");
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

    const processLead = async (lead: (typeof chunk)[0]) => {
      // Resolve style: explicit batch style → inferred from persona/industry → direct-ask fallback
      const resolvedStyle = batchStyle ?? inferStyle(lead.persona, lead.industry, lead.vertical);
      const styleConfig = STYLE_GUIDES[resolvedStyle] ?? STYLE_GUIDES["direct-ask"];
      const usePS = styleConfig.usePS;

      // Build stable system prompt per style (cached by Anthropic per unique prompt text)
      const systemPrompt = `You are an expert B2B cold email writer for ${workspace.senderName ?? "the sender"}.

PRODUCT:
${productSummary}

IDEAL CUSTOMER PROFILE:
${icp}${proofPointsText}${socialProofText}${structureBlock}

EMAIL RULES:
- Subject line: 6–10 words max, no punctuation, no clickbait, no ALL CAPS
- Step 1 body: 3–5 sentences, under ${MAX_BODY_WORDS} words, end with ONE soft CTA
${usePS ? `- Include a P.S. line in step 1 — reference something real and specific about them (recent launch, campaign, hire, news)` : `- Do NOT include a P.S. line — the style requires a clean ending`}
- Steps 2+ must NOT open with a greeting — they thread as inbox replies (Re: subject)
- Steps 2+ are short follow-ups: add a new angle, do not repeat step 1 verbatim
- Never use exclamation marks, jargon, or generic claims like "I came across your profile"
- Write as a human peer, not a marketer
- Sign off as: ${workspace.senderName?.trim() ?? "Best, [Sender]"}

${styleConfig.prompt}`;
      let companyContextBlock = "";
      let companyContextRaw: string | null = null;
      if (useWebScraping && lead.website?.trim()) {
        const scraped = await scrapeForContext(lead.website.trim());
        if (scraped) {
          companyContextRaw = scraped;
          companyContextBlock = `\n\nCompany website context (use to personalize — recent news, products, tone):\n${scraped}`;
        }
      } else if (useLandingPage && lead.website?.trim()) {
        // Always scrape for LP research even if useWebScraping is off
        const scraped = await scrapeForContext(lead.website.trim());
        if (scraped) companyContextRaw = scraped;
      }

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
          const openRate = p.open_rate_pct_avg ?? 0;
          parts.push(`Persona "${lead.persona}": open rate ${openRate}%, click rate ${p.click_rate_pct_avg ?? "?"}%, ${p.positive_reply_count ?? 0} positive replies`);
          if (openRate > 0 && openRate < 15) {
            instructions.push(`For "${lead.persona}" (low ${openRate}% open rate): write SHORTER subject lines (under 50 chars), use curiosity hooks or questions.`);
          } else if (openRate >= 25) {
            instructions.push(`For "${lead.persona}" (strong ${openRate}% open rate): keep similar subject style that worked.`);
          }
        }
        if (lead.vertical && memory.byVertical[lead.vertical]) {
          const v = memory.byVertical[lead.vertical];
          const posReplies = v.positive_reply_count ?? 0;
          parts.push(`Vertical "${lead.vertical}": open rate ${v.open_rate_pct_avg ?? "?"}%, ${posReplies} positive replies`);
          if (posReplies > 0) {
            instructions.push(`Vertical "${lead.vertical}" converts — emphasize value and proof that resonate with this segment.`);
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

      const userMessage = `Write a ${numSteps}-step hyper-personalized cold email sequence for this lead. Make it feel 1:1 — completely custom, not a template.${strategyBlock}

LEAD:
- Name: ${lead.name ?? "unknown"}
- Title: ${lead.jobTitle ?? "unknown"}
- Company: ${lead.company ?? "unknown"}
- Industry: ${lead.industry ?? "unknown"}${lead.website ? `\n- Website: ${lead.website}` : ""}${lead.persona || lead.vertical ? `\n- Persona: ${lead.persona ?? ""} | Vertical: ${lead.vertical ?? ""}` : ""}${companyContextBlock}${videoBlock}${landingPageBlock}

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

        // Auto-shorten any step body that exceeds word limit
        for (const step of stepsArray) {
          if (wordCount(step.body) > MAX_BODY_WORDS) {
            try {
              const { text: shortened } = await callAnthropic(
                anthropicKey,
                `Shorten this cold email body to under ${MAX_BODY_WORDS} words. Preserve the key message and CTA. Return only the shortened body text, no commentary:\n\n${step.body}`,
                { maxTokens: 300, model }
              );
              step.body = shortened.trim();
            } catch {
              // keep original if shorten fails
            }
          }
        }

        const update: Record<string, string | null> = {
          stepsJson: JSON.stringify(stepsArray),
          emailStyle: resolvedStyle, // always save — inferred or explicit
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

        await prisma.lead.update({
          where: { id: lead.id },
          data: update,
        });
        return { leadId: lead.id, usage };
      } catch (err) {
        console.error(`Lead ${lead.id} personalize error:`, err instanceof Error ? err.message : err);
        return { leadId: lead.id, usage };
      }
    };

    // Process with limited concurrency to avoid exhausting DB connection pool
    // Claude API calls can be parallel but DB writes need to be controlled
    const CONCURRENCY = 5;
    const results: Array<{ leadId: string; usage: { input_tokens: number; output_tokens: number } }> = [];
    for (let i = 0; i < chunk.length; i += CONCURRENCY) {
      const batch = chunk.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map(processLead));
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

    return NextResponse.json({
      done: chunk.length,
      total,
      leadIds,
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
