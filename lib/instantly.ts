/**
 * Instantly API v2 client. All calls use the user's Instantly API key (Bearer).
 * Base: https://api.instantly.ai/api/v2
 */

const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";

export type InstantlyAccount = {
  email: string;
  first_name: string;
  last_name: string;
  warmup_status: number; // 0=Paused, 1=Active, -1=Banned, -2=Spam Unknown, -3=Permanent Suspension
  domain?: string;
  daily_limit?: number | null;
  setup_pending?: boolean;
  timestamp_created?: string;
  timestamp_updated?: string;
};

export type DfyOrderItem = {
  domain: string;
  email_provider?: number; // 1 = Google
  forwarding_domain?: string;
  accounts?: Array<{
    first_name: string;
    last_name: string;
    email_address_prefix: string; // e.g. "john" -> john@domain.com
  }>;
};

export type DfyOrderType = "dfy" | "pre_warmed_up" | "extra_accounts";

export type DfyPlaceOrderPayload = {
  items: DfyOrderItem[];
  order_type: DfyOrderType;
  simulation?: boolean;
};

export type DfyPlaceOrderResponse = {
  order_placed: boolean;
  order_is_valid: boolean;
  unavailable_domains: string[];
  blacklist_domains: string[];
  invalid_domains: string[];
  invalid_forwarding_domains: string[];
  invalid_accounts?: Array<{ domain: string; first_name: string; last_name: string; email: string; reason: string }>;
  missing_domain_orders?: string[];
  domains_without_accounts?: string[];
  free_domains?: string[];
  number_of_domains_ordered?: number;
  number_of_accounts_ordered?: number;
  total_accounts_price_per_month?: number;
  price_per_domain_per_year?: number;
  total_domains_price_per_year?: number;
  total_price?: number;
  order_items?: Array<{
    domain: string;
    accounts: Array<{ email_address_prefix: string; first_name: string; last_name: string }>;
    domain_price: number;
    accounts_price?: number;
    email_provider?: number;
    forwarding_domain?: string;
  }>;
};

function createInstantlyClient(apiKey: string) {
  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number>
  ): Promise<T> {
    let url = `${INSTANTLY_API_BASE}${path}`;
    if (query && Object.keys(query).length > 0) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== "") params.set(k, String(v));
      }
      const q = params.toString();
      if (q) url += (path.includes("?") ? "&" : "?") + q;
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    // POST/PATCH with application/json must send a body; some APIs reject empty body
    const needsBody = method !== "GET" && method !== "HEAD";
    const bodyPayload =
      body !== undefined ? JSON.stringify(body) : needsBody ? "{}" : undefined;
    const res = await fetch(url, {
      method,
      headers,
      ...(bodyPayload !== undefined && { body: bodyPayload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const d = data as Record<string, unknown>;
      // Log full raw response for debugging
      console.error(`[instantly] ${method} ${path} -> ${res.status}:`, JSON.stringify(d).slice(0, 500));
      const err =
        typeof d?.message === "string" ? d.message
        : typeof d?.error === "string" ? d.error
        : typeof d?.detail === "string" ? d.detail
        : typeof d?.error === "object" && d?.error != null && typeof (d.error as Record<string, unknown>).message === "string"
          ? (d.error as Record<string, string>).message
        : res.statusText;
      throw new Error(typeof err === "string" ? err : "Instantly API error");
    }
    return data as T;
  }

  return {
    /** List all email accounts in the workspace (fetches all pages) */
    async listAccounts(): Promise<InstantlyAccount[]> {
      const all: InstantlyAccount[] = [];
      const limit = 100;
      let startingAfter: string | undefined;
      type Page = { data?: InstantlyAccount[]; items?: InstantlyAccount[]; accounts?: InstantlyAccount[]; next_starting_after?: string };
      do {
        const data = await request<Page>("GET", "/accounts", undefined, {
          limit,
          ...(startingAfter && { starting_after: startingAfter }),
        });
        const obj = data as Record<string, unknown>;
        let pageItems: InstantlyAccount[] = [];
        for (const key of ["items", "data", "accounts"]) {
          const arr = obj[key];
          if (Array.isArray(arr)) {
            pageItems = arr as InstantlyAccount[];
            break;
          }
        }
        all.push(...pageItems);
        startingAfter = typeof obj.next_starting_after === "string" ? obj.next_starting_after : undefined;
      } while (startingAfter);
      return all;
    },

    /** Enable warmup for the given email addresses */
    async enableWarmup(emails: string[]): Promise<unknown> {
      return request("POST", "/accounts/warmup/enable", { emails });
    },

    /** Disable warmup for the given email addresses */
    async disableWarmup(emails: string[]): Promise<unknown> {
      return request("POST", "/accounts/warmup/disable", { emails });
    },

    /** Check domain availability for DFY orders (max 50 domains per request) */
    async dfyCheckDomains(domains: string[]): Promise<{
      domains: Array<{ domain: string; available: boolean }>;
    }> {
      return request("POST", "/dfy-email-account-orders/domains/check", {
        domains: domains.slice(0, 50),
      });
    },

    /** Get list of similar available domains */
    async dfySimilarDomains(
      domain: string,
      extensions?: string[]
    ): Promise<{ domains: string[] }> {
      return request("POST", "/dfy-email-account-orders/domains/similar", {
        domain,
        ...(extensions?.length && { extensions }),
      });
    },

    /** Get pre-warmed up domains available for order */
    async dfyPreWarmedList(params?: {
      extensions?: string[];
      search?: string;
    }): Promise<{ domains: string[] }> {
      return request("POST", "/dfy-email-account-orders/domains/pre-warmed-up-list", params ?? {});
    },

    /** Place a DFY email account order (or run simulation) */
    async dfyPlaceOrder(payload: DfyPlaceOrderPayload): Promise<DfyPlaceOrderResponse> {
      return request("POST", "/dfy-email-account-orders", {
        items: payload.items,
        order_type: payload.order_type,
        simulation: payload.simulation ?? false,
      });
    },

    /** PATCH account (e.g. daily_limit, enable_slow_ramp for ramp). Email must be URL-encoded. */
    async patchAccount(
      email: string,
      data: { daily_limit?: number; enable_slow_ramp?: boolean }
    ): Promise<unknown> {
      const encoded = encodeURIComponent(email);
      return request("PATCH", `/accounts/${encoded}`, data);
    },

    /** Set daily send limits: cold inboxes get unwarmedDailyLimit + slow ramp; warm inboxes get warmedDailyLimit. If accountEmails is set, only those accounts are updated. */
    async applyRampForUnwarmedAccounts(options?: {
      unwarmedDailyLimit?: number;
      warmedDailyLimit?: number;
      /** If set, only apply to these account emails; otherwise all accounts. */
      accountEmails?: string[];
    }): Promise<{ updated: number }> {
      let accounts = await this.listAccounts();
      const filter = options?.accountEmails;
      if (filter != null && filter.length > 0) {
        const set = new Set(filter.map((e) => e.toLowerCase().trim()));
        accounts = accounts.filter((a) => set.has(a.email.toLowerCase()));
      }
      const unwarmedLimit = options?.unwarmedDailyLimit ?? 5;
      const warmedLimit = options?.warmedDailyLimit ?? 30;
      let updated = 0;
      for (const acc of accounts) {
        const isWarmed = acc.warmup_status === 1;
        try {
          if (isWarmed) {
            await this.patchAccount(acc.email, { daily_limit: warmedLimit });
          } else {
            await this.patchAccount(acc.email, {
              daily_limit: unwarmedLimit,
              enable_slow_ramp: true,
            });
          }
          updated++;
        } catch {
          // skip failed account
        }
      }
      return { updated };
    },

    /** Create a campaign. Returns campaign id. email_list = account emails to send from; if omitted, Instantly uses all workspace accounts. */
    async createCampaign(
      name: string,
      options?: {
        schedule?: {
          from?: string;
          to?: string;
          days?: boolean[];
          timezone?: string;
        };
        /** Account emails to use for sending. If provided, only these accounts are used; otherwise all workspace accounts. */
        email_list?: string[];
        /** Sequence steps (subject, body, delay). If provided, campaign will have this email sequence in the Sequences tab. */
        sequenceSteps?: Array<{ subject: string; body: string; delayDays: number }>;
        /** Delay unit for sequence steps. Default "days". Use "minutes" for test campaigns so emails arrive within minutes. */
        delayUnit?: "days" | "minutes";
      }
    ): Promise<{ id: string }> {
      const schedule = options?.schedule;
      const from = schedule?.from ?? "09:00";
      const to = schedule?.to ?? "17:00";
      const days = schedule?.days ?? [true, true, true, true, true, false, false]; // Mon-Fri
      const timezone = schedule?.timezone ?? "America/Chicago";
      const campaign_schedule = {
        schedules: [
          {
            name: "Weekdays",
            timing: { from, to },
            days: { 0: days[0], 1: days[1], 2: days[2], 3: days[3], 4: days[4], 5: days[5], 6: days[6] },
            timezone,
          },
        ],
      };
      const body: {
        name: string;
        campaign_schedule: typeof campaign_schedule;
        email_list?: string[];
        sequences?: Array<{
          steps: Array<{
            type: string;
            delay: number;
            delay_unit?: string;
            variants: Array<{ subject: string; body: string }>;
          }>;
        }>;
      } = {
        name,
        campaign_schedule,
      };
      if (options?.email_list != null && options.email_list.length > 0) {
        body.email_list = options.email_list;
      }
      if (options?.sequenceSteps != null && options.sequenceSteps.length > 0) {
        const unit = options.delayUnit ?? "days";
        body.sequences = [
          {
            steps: options.sequenceSteps.map((s) => ({
              type: "email",
              delay: s.delayDays,
              delay_unit: unit,
              variants: [{ subject: s.subject, body: s.body }],
            })),
          },
        ];
      }
      const data = await request<{ id?: string }>("POST", "/campaigns", body);
      const id =
        (data as { id?: string }).id ??
        (data as { campaign?: { id?: string } }).campaign?.id ??
        (data as Record<string, unknown>).id;
      if (!id || typeof id !== "string") throw new Error("Instantly did not return campaign id");
      return { id };
    },

    /** Bulk add leads to a campaign (chunks of 1000). Each lead: email, first_name?, last_name?, company_name?, personalization (body), custom_variables? */
    async bulkAddLeadsToCampaign(
      campaignId: string,
      leads: Array<{
        email: string;
        first_name?: string | null;
        last_name?: string | null;
        company_name?: string | null;
        personalization?: string | null;
        custom_variables?: Record<string, string>;
      }>,
      options?: { skip_if_in_workspace?: boolean; skip_if_in_campaign?: boolean; verify_leads_on_import?: boolean }
    ): Promise<{ leads_uploaded: number; duplicated_leads: number; in_blocklist: number }> {
      const chunkSize = 100; // smaller chunks to avoid payload size limits
      let totalUploaded = 0;
      let totalDuplicated = 0;
      let totalInBlocklist = 0;
      for (let i = 0; i < leads.length; i += chunkSize) {
        const chunk = leads.slice(i, i + chunkSize);
        // Log payload size for debugging
        if (i === 0) {
          const sample = chunk[0];
          const cvSizes = Object.entries(sample?.custom_variables ?? {}).map(([k, v]) => `${k}:${v.length}`).join(", ");
          console.log(`[instantly] /leads/add chunk 0: ${chunk.length} leads, cv sizes: ${cvSizes}`);
        }
        const body = {
          campaign_id: campaignId,
          leads: chunk.map((l) => ({
            email: l.email,
            first_name: l.first_name ?? undefined,
            last_name: l.last_name ?? undefined,
            company_name: l.company_name ?? undefined,
            personalization: l.personalization ?? undefined,
            custom_variables: l.custom_variables ?? undefined,
          })),
          // Don't skip leads that exist elsewhere — add them to this campaign (so "Send to Instantly" actually populates the campaign)
          skip_if_in_workspace: options?.skip_if_in_workspace ?? false,
          skip_if_in_campaign: options?.skip_if_in_campaign ?? false,
          verify_leads_on_import: options?.verify_leads_on_import ?? false,
        };
        const res = await request<{
          leads_uploaded?: number;
          duplicated_leads?: number;
          in_blocklist?: number;
        }>("POST", "/leads/add", body);
        totalUploaded += res.leads_uploaded ?? 0;
        totalDuplicated += res.duplicated_leads ?? 0;
        totalInBlocklist += res.in_blocklist ?? 0;
      }
      return {
        leads_uploaded: totalUploaded,
        duplicated_leads: totalDuplicated,
        in_blocklist: totalInBlocklist,
      };
    },

    /** Register custom variable names on a campaign so sequence steps can use {{variable}} per lead. */
    async addCampaignVariables(campaignId: string, variableNames: string[]): Promise<unknown> {
      if (variableNames.length === 0) return undefined;
      return request("POST", `/campaigns/${campaignId}/variables`, { variables: variableNames });
    },

    /** Activate a campaign so it starts sending. */
    async activateCampaign(campaignId: string): Promise<unknown> {
      return request("POST", `/campaigns/${campaignId}/activate`);
    },

    /** Pause (stop) a campaign. */
    async pauseCampaign(campaignId: string): Promise<unknown> {
      return request("POST", `/campaigns/${campaignId}/pause`);
    },

    async deleteCampaign(campaignId: string): Promise<unknown> {
      return request("DELETE", `/campaigns/${campaignId}`);
    },

    /** Get campaign analytics (opens, clicks, sent, etc.). */
    async getCampaignAnalytics(
      campaignId: string,
      options?: { start_date?: string; end_date?: string }
    ): Promise<InstantlyCampaignAnalytics | null> {
      const query: Record<string, string> = { id: campaignId };
      if (options?.start_date) query.start_date = options.start_date;
      if (options?.end_date) query.end_date = options.end_date;
      const data = await request<InstantlyCampaignAnalytics[] | InstantlyCampaignAnalytics>(
        "GET",
        "/campaigns/analytics",
        undefined,
        query as Record<string, string | number>
      );
      const arr = Array.isArray(data) ? data : [data];
      return arr.length > 0 ? (arr[0] as InstantlyCampaignAnalytics) : null;
    },
  };
}

export type InstantlyCampaignAnalytics = {
  campaign_id: string;
  campaign_name: string;
  campaign_status: number;
  leads_count?: number;
  contacted_count?: number;
  open_count?: number;
  open_count_unique?: number;
  reply_count?: number;
  link_click_count?: number;
  link_click_count_unique?: number;
  emails_sent_count?: number;
  bounced_count?: number;
  unsubscribed_count?: number;
  completed_count?: number;
};

export type InstantlyClient = ReturnType<typeof createInstantlyClient>;

export function getInstantlyClient(apiKey: string): InstantlyClient {
  return createInstantlyClient(apiKey);
}

/** Get an Instantly client for the given user ID (fetches workspace and decrypts key). Returns null if no key. */
export async function getInstantlyClientForUserId(userId: string): Promise<{
  client: InstantlyClient;
} | null> {
  const { prisma } = await import("@/lib/prisma");
  const { decrypt } = await import("@/lib/encryption");
  const workspace = await prisma.workspace.findUnique({
    where: { userId },
    select: { instantlyKey: true },
  });
  if (!workspace?.instantlyKey) return null;
  const apiKey = decrypt(workspace.instantlyKey);
  return { client: createInstantlyClient(apiKey) };
}

/** Get an Instantly client for the given workspace ID. Returns null if no key configured. */
export async function getInstantlyClientForWorkspaceId(workspaceId: string): Promise<{
  client: InstantlyClient;
} | null> {
  const { prisma } = await import("@/lib/prisma");
  const { decrypt } = await import("@/lib/encryption");
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { instantlyKey: true },
  });
  if (!workspace?.instantlyKey) return null;
  const apiKey = decrypt(workspace.instantlyKey);
  return { client: createInstantlyClient(apiKey) };
}
