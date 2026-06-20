# Competitor-testimonial poaching — a signal-based lead source

**Thesis:** anyone publicly praising a competitor (Listen Labs, Outset, Evidenza, VoicePanel)
has already bought into AI consumer research and has budget for it. That's the warmest cold
audience we can find. They're a better-fit ICP than a generic Apollo pull.

**Why this fits the Apollo crunch:** these are *known companies and people from public sources* —
we don't need Apollo credits to find them. The cheapest path to reach is **LinkedIn**, which only
needs the company name to target. Spend Apollo credits (if any) only on the highest-value handful.

## Seed list (from public testimonials/case studies, 2026-06-19)
Companies whose teams publicly use a competitor → target their insights / brand / growth leaders:
- **Listen Labs:** Microsoft, Canva, Chubbies, Emerald Research Group
- **Outset:** HubSpot, Away, Glassdoor, Indeed (+ a quoted "Consumer Insights Sr. Manager")
- **Evidenza:** BlackRock, Microsoft, JP Morgan, Dentsu, Salesforce, Mars, EY
- **VoicePanel:** YC-backed; named reviewers live on G2 + Greenbook (loop to pull specific names)

**Named people (reach directly — warmest):**
- **Jennifer Lien — Senior UX Researcher, Away.** Public Outset case study (ran 75 AI-moderated interviews overnight, set an add-to-cart record). Does exactly the research Gather serves; B2C travel brand = perfect ICP.
- **Jim Lesser — brand chief, ServiceNow.** Publicly said *not* to work with Evidenza (wants to keep the research edge in-house). Warm angle: Gather gives the edge without the synthetic-data trust problem.
- **Indeed — Consumer Insights Sr. Manager** (unnamed in public quote, praised Outset) → find via LinkedIn.

**Prioritize the B2C consumer brands** (Gather's true ICP): Away, Chubbies, Canva, Mars, Indeed, Glassdoor. Deprioritize for B2C fit: Microsoft, BlackRock, JP Morgan, Salesforce, EY (still valid for enterprise, lower fit).
**LinkedIn target titles at these companies:** Consumer/Customer Insights, UX Researcher, Brand Director/Manager, VP/Head of Marketing, Head of Growth.

Ready-to-upload company audience: **`competitor-target-companies.csv`** (LinkedIn company-list format).

## How to reach them (priority order, Apollo-light)
1. **LinkedIn matched audience (now):** upload `competitor-target-companies.csv` in Campaign Manager →
   run Gather ads at Insights/Brand/Growth titles at those companies. No emails needed. Ties straight
   into the surround-sound loop we already built.
2. **LinkedIn content + targeted outreach:** post Gather research aimed at insights leaders; the loop
   can find specific names at these companies via search (titles are public).
3. **Email (sparingly):** only enrich the few best (e.g., Jim Lesser) so we don't burn Apollo. Once
   emailed, they flow through the same pipeline → eligible for the offer (incentives) send.

## What the loop should build out (backlog)
- Pull *specific named people* (not just companies) from G2/Greenbook reviewer profiles + LinkedIn for
  each competitor; tag them persona via `personaForTitle`.
- A generator that turns a competitor-poach list into a `LeadBatch` (tag `source: competitor-poach`)
  so results are attributable as its own channel.
- Refresh monthly — new testimonials/case studies appear constantly.

Sources: [Listen Labs case study](https://listenlabs.ai/case-studies/emerald-research-group) ·
[Outset customers](https://outset.ai/customers) · [Evidenza (Mars/EY/ServiceNow)](https://www.mi-3.com.au/27-08-2024/synthetic-customers-meet-synthetic-cmos-and-cfos-evidenza-clones-sharp-ritson-binet) ·
[VoicePanel on Greenbook](https://www.greenbook.org/company/Voicepanel)
