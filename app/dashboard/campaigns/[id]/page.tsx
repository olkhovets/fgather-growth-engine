"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { APP_DISPLAY_NAME } from "@/lib/app-config";

type Step = "playbook" | "sequences" | "send";

type CampaignData = {
  id: string;
  name: string;
  status: string;
  playbookJson: string | null;
  icp: string | null;
  leadBatchId: string | null;
  ctaUrl: string | null;
  leadBatch?: {
    id: string;
    name: string | null;
    leads: Array<{ id: string; email: string; name: string | null; company: string | null; jobTitle: string | null; step1Subject: string | null; step1Body: string | null; stepsJson: string | null }>;
  } | null;
  sentCampaigns: Array<{ id: string; name: string; instantlyCampaignId: string; createdAt: string }>;
};

export default function CampaignPage() {
  const params = useParams();
  const router = useRouter();
  const { ready, loading: guardLoading, session } = useAuthGuard();
  const id = params.id as string;

  const [campaign, setCampaign] = useState<CampaignData | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("playbook");
  const [editingGuidelines, setEditingGuidelines] = useState<{
    context: string;
    numSteps: number;
    stepDelays: number[];
  }>({ context: "", numSteps: 3, stepDelays: [1, 3, 5] });
  const [savingPlaybook, setSavingPlaybook] = useState(false);
  const [playbookError, setPlaybookError] = useState("");
  const [batches, setBatches] = useState<Array<{ id: string; name: string | null; leadCount: number }>>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [generateProgress, setGenerateProgress] = useState<{ total: number; generated: number } | null>(null);
  const [useFastModel, setUseFastModel] = useState(true);
  const [useWebScraping, setUseWebScraping] = useState(false);
  const [useLandingPage, setUseLandingPage] = useState(false);
  const [ctaUrl, setCtaUrl] = useState("");
  const [useVideo, setUseVideo] = useState(false);
  const [hasLumaKey, setHasLumaKey] = useState(false);
  const [hasRunwayKey, setHasRunwayKey] = useState(false);
  const [generatingVideos, setGeneratingVideos] = useState(false);
  const [videoProvider, setVideoProvider] = useState<"luma" | "runway">("luma");
  useEffect(() => {
    if (hasLumaKey && !hasRunwayKey) setVideoProvider("luma");
    if (hasRunwayKey && !hasLumaKey) setVideoProvider("runway");
  }, [hasLumaKey, hasRunwayKey]);
  const [csvInput, setCsvInput] = useState("");
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetImporting, setSheetImporting] = useState(false);
  const [sheetError, setSheetError] = useState("");
  const [campaignNameInput, setCampaignNameInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [instantlyAccounts, setInstantlyAccounts] = useState<Array<{ email: string }>>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selectedAccountEmails, setSelectedAccountEmails] = useState<string[] | null>(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [validation, setValidation] = useState<{
    numSteps: number;
    totalLeads: number;
    leadsWithNoContent: number;
    leadsPassingAllSteps: number;
    canSend: boolean;
    steps: Array<{ step: number; passed: number; failed: number; passedAllLeads: boolean; sampleFailures: string[] }>;
  } | null>(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const [diagnose, setDiagnose] = useState<{ verdict: string; noSequence: number; total: number; sampleProblems: string[] } | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [samples, setSamples] = useState<Array<{
    persona: string;
    exampleLead?: { name: string; company: string; jobTitle: string; industry?: string };
    steps: Array<{ subject: string; body: string }>;
  }>>([]);
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [sampleError, setSampleError] = useState("");
  const [sampleJobTitle, setSampleJobTitle] = useState("");
  const [sampleCompanyUrl, setSampleCompanyUrl] = useState("");

  useEffect(() => {
    if (!id || !session?.user?.id) return;
    fetch(`/api/campaigns/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.campaign) {
          setCampaign(data.campaign);
          setCampaignNameInput(data.campaign.name || "");
          if (data.campaign.playbookJson) {
            try {
              const pb = JSON.parse(data.campaign.playbookJson) as {
                guidelines?: { context?: string; tone?: string; structure?: string; numSteps?: number; stepDelays?: number[] };
                steps?: Array<{ stepNumber?: number; subject: string; body: string; delayDays: number }>;
              };
              if (pb?.guidelines) {
                const g = pb.guidelines;
                // Prefer explicit context; fall back to combining legacy tone + structure
                const context = g.context
                  ?? (g.tone || g.structure ? [g.tone, g.structure].filter(Boolean).join("\n\n") : "");
                setEditingGuidelines({
                  context,
                  numSteps: Math.min(10, Math.max(1, g.numSteps ?? 3)),
                  stepDelays: Array.isArray(g.stepDelays) ? g.stepDelays : [1, 3, 5],
                });
              } else if (pb?.steps?.length) {
                const steps = pb.steps;
                const delays = steps.map((s) => (typeof s.delayDays === "number" ? s.delayDays : 0));
                setEditingGuidelines({
                  context: steps.map((s, i) => `Step ${i + 1}: ${(s.subject || "").slice(0, 50)}`).join("\n"),
                  numSteps: steps.length,
                  stepDelays: delays,
                });
              }
            } catch {
              //
            }
          }
          if (data.campaign.leadBatchId) {
            setSelectedBatchId(data.campaign.leadBatchId);
          }
          if (data.campaign.ctaUrl) {
            setCtaUrl(data.campaign.ctaUrl);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/onboarding")
      .then((r) => r.json())
      .then((data) => {
        if (data.workspace) {
          setHasLumaKey(Boolean(data.workspace.hasLumaKey));
          setHasRunwayKey(Boolean(data.workspace.hasRunwayKey));
        }
      })
      .catch(() => {});
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/leads")
      .then((r) => r.json())
      .then((data) => setBatches(data.batches ?? []))
      .catch(() => {});
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) return;
    setAccountsLoading(true);
    fetch("/api/instantly/accounts")
      .then((r) => r.json())
      .then((data) => {
        const accs = data.accounts ?? [];
        setInstantlyAccounts(accs);
        if (accs.length > 0 && selectedAccountEmails === null) setSelectedAccountEmails(accs.map((a: { email: string }) => a.email));
      })
      .catch(() => {})
      .finally(() => setAccountsLoading(false));
  }, [session?.user?.id]);

  useEffect(() => {
    if (step !== "sequences") {
      setGenerateProgress(null);
      return;
    }
    if (selectedBatchId && !generating) {
      fetch(`/api/leads/generate/status?batchId=${encodeURIComponent(selectedBatchId)}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.total != null && data.generated != null) setGenerateProgress({ total: data.total, generated: data.generated });
        })
        .catch(() => {});
    }
  }, [step, selectedBatchId, generating]);

  useEffect(() => {
    if (step !== "send" || !campaign?.leadBatchId || !id) {
      setValidation(null);
      setDiagnose(null);
      return;
    }
    setValidationLoading(true);
    fetch(`/api/instantly/send/validate?batchId=${encodeURIComponent(campaign.leadBatchId)}&campaignId=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.numSteps != null) {
          const v = {
            numSteps: data.numSteps,
            totalLeads: data.totalLeads,
            leadsWithNoContent: data.leadsWithNoContent ?? 0,
            leadsPassingAllSteps: data.leadsPassingAllSteps,
            canSend: data.canSend === true,
            steps: data.steps ?? [],
          };
          setValidation(v);
          if (!testEmail && session?.user?.email) setTestEmail(session.user.email);
          // If not ready to send, fetch a diagnosis to show specific reason
          if (!v.canSend) {
            fetch(`/api/leads/diagnose?batchId=${encodeURIComponent(campaign.leadBatchId!)}`)
              .then((r) => r.json())
              .then((d) => setDiagnose({ verdict: d.verdict, noSequence: d.noSequence, total: d.total, sampleProblems: d.sampleProblems ?? [] }))
              .catch(() => {});
          } else {
            setDiagnose(null);
          }
        } else {
          setValidation(null);
        }
      })
      .catch(() => setValidation(null))
      .finally(() => setValidationLoading(false));
  }, [step, campaign?.leadBatchId, id, session?.user?.email]);

  const savePlaybookAndNext = async () => {
    if (!id) return;
    setSavingPlaybook(true);
    setPlaybookError("");
    try {
      const playbookJson = JSON.stringify({
        guidelines: {
          context: editingGuidelines.context,
          numSteps: editingGuidelines.numSteps,
          stepDelays: editingGuidelines.stepDelays,
        },
      });
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playbookJson }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to save");
      }
      setCampaign((c) => c ? { ...c, playbookJson } : null);
      setStep("sequences");
    } catch (e) {
      setPlaybookError(e instanceof Error ? e.message : "Failed to save playbook");
    } finally {
      setSavingPlaybook(false);
    }
  };

  const fetchGenerateProgress = async () => {
    if (!selectedBatchId) return;
    try {
      const res = await fetch(`/api/leads/generate/status?batchId=${encodeURIComponent(selectedBatchId)}`);
      const data = await res.json();
      if (res.ok && data.total != null && data.generated != null) {
        setGenerateProgress({ total: data.total, generated: data.generated });
        return data;
      }
    } catch {
      // ignore
    }
    return null;
  };

  const generateAll = async () => {
    if (!id || !selectedBatchId) {
      setGenerateError("Select or upload a lead list first.");
      return;
    }
    setGenerateError("");
    setGenerating(true);
    setGenerateProgress(null);
    try {
      await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadBatchId: selectedBatchId }),
      });
    } catch {
      // ignore
    }
    let lastProgress: { total: number; generated: number } | null = null;
    try {
      let status = await fetchGenerateProgress();
      if (!status) {
        setGenerateError("Could not fetch progress.");
        return;
      }
      lastProgress = status;

      const fetchChunkWithRetry = async (attempt = 0): Promise<Response> => {
        try {
          return await fetch("/api/leads/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ batchId: selectedBatchId, campaignId: id, limit: 10, useFastModel, useWebScraping, useLandingPage, useVideo }),
          });
        } catch (networkErr) {
          if (attempt < 3) {
            // Exponential backoff: 2s, 4s, 8s
            await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
            return fetchChunkWithRetry(attempt + 1);
          }
          throw networkErr;
        }
      };

      let cumulativeDone = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await fetchChunkWithRetry();
        const text = await res.text();
        let data: { error?: string; done?: number; total?: number } = {};
        try { data = text ? JSON.parse(text) : {}; } catch {
          throw new Error(text?.slice(0, 200) || `Generate failed (${res.status})`);
        }
        if (!res.ok) throw new Error(data.error || text?.slice(0, 200) || "Generate failed");
        const chunkDone = data.done ?? 0;
        if (chunkDone === 0) break; // no more leads need work
        cumulativeDone += chunkDone;
        setGenerateProgress({ total: status.total, generated: cumulativeDone });
        await new Promise((r) => setTimeout(r, 300));
      }
      setStep("send");
      setCampaign((c) => c ? { ...c, status: "sequences_ready", leadBatchId: selectedBatchId } : null);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Generate failed";
      const resumeHint = lastProgress && lastProgress.generated > 0 && lastProgress.generated < lastProgress.total
        ? ` ${lastProgress.generated}/${lastProgress.total} already done — click Generate again to resume from where it stopped.`
        : "";
      setGenerateError(errMsg + resumeHint);
      try {
        await fetch("/api/feedback/error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: "Sequence generation failed",
            error: errMsg,
            extra: { campaignId: id, batchId: selectedBatchId, progress: lastProgress },
          }),
        });
      } catch {
        // ignore
      }
    } finally {
      setGenerating(false);
      // Keep progress visible so user can resume
    }
  };

  const handleUpload = async (force = false) => {
    if (!csvInput.trim()) {
      setUploadError("Paste CSV content (headers: email, name, company, job title).");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      // Parse CSV client-side to avoid Vercel's 4.5MB JSON body limit.
      // Only send normalized lead rows (email, name, company, etc.) — much smaller than raw CSV.
      const lines = csvInput.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) throw new Error("CSV must have a header row and at least one data row.");

      const firstLine = lines[0];
      const isTab = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length;
      const split = (line: string) => isTab
        ? line.split("\t").map((v) => v.trim().replace(/^"|"$/g, ""))
        : (() => {
            const result: string[] = []; let cur = ""; let inQ = false;
            for (const c of line) {
              if (c === '"') inQ = !inQ;
              else if (c === "," && !inQ) { result.push(cur.trim().replace(/^"|"$/g, "")); cur = ""; }
              else cur += c;
            }
            result.push(cur.trim().replace(/^"|"$/g, ""));
            return result;
          })();

      const headers = split(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
      const ALIASES: Record<string, string> = {
        email: "email", e_mail: "email", work_email: "email",
        first_name: "name", firstname: "name", name: "name", full_name: "name",
        job_title: "job_title", jobtitle: "job_title", title: "job_title",
        company: "company", company_name: "company", organization: "company",
        website: "website", company_url: "website", company_website: "website",
        industry: "industry",
      };
      const get = (row: Record<string, string>, ...keys: string[]) => {
        for (const k of keys) { const v = row[k] ?? row[ALIASES[k]]; if (v) return v; }
        return "";
      };

      const leads: Array<{ email: string; name?: string; jobTitle?: string; company?: string; website?: string; industry?: string }> = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = split(lines[i]);
        const row: Record<string, string> = {};
        headers.forEach((h, j) => { row[h] = vals[j]?.trim() ?? ""; });
        if (!Object.values(row).some((v) => v)) continue;
        const email = get(row, "email", "e_mail", "work_email") || vals[0] || "";
        if (!email?.trim()) continue;
        const rawSite = get(row, "website", "company_url", "company_website");
        leads.push({
          email: email.trim(),
          name: get(row, "name", "first_name", "firstname", "full_name") || undefined,
          jobTitle: get(row, "job_title", "jobtitle", "title") || undefined,
          company: get(row, "company", "company_name", "organization") || undefined,
          website: rawSite ? (rawSite.startsWith("http") ? rawSite : `https://${rawSite.replace(/^www\./, "")}`) : undefined,
          industry: get(row, "industry") || undefined,
        });
      }

      if (leads.length === 0) throw new Error("No valid rows with email found. Check your column headers.");

      // Send in chunks of 500 to stay well under Vercel's 4.5MB body limit
      const CHUNK = 500;
      let batchId: string | null = null;
      let totalCount = 0;
      for (let i = 0; i < leads.length; i += CHUNK) {
        const chunk = leads.slice(i, i + CHUNK);
        const isFirst = i === 0;
        const res: Response = await fetch("/api/leads/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leads: chunk, force, batchId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
        if (isFirst) batchId = data.batchId;
        totalCount = data.count;
      }

      setSelectedBatchId(batchId!);
      setBatches((prev) => [{ id: batchId!, name: null, leadCount: totalCount }, ...prev]);
      setCsvInput("");
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleSheetImport = async () => {
    const url = sheetUrl.trim();
    if (!url) {
      setSheetError("Paste a Google Sheets URL.");
      return;
    }
    setSheetImporting(true);
    setSheetError("");
    try {
      const res = await fetch("/api/leads/import/sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetUrl: url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setSelectedBatchId(data.batchId);
      setBatches((prev) => [{ id: data.batchId, name: `Sheet import`, leadCount: data.count }, ...prev]);
      setSheetUrl("");
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setSheetImporting(false);
    }
  };

  const handleTestCampaign = async () => {
    if (!id || !campaign?.leadBatchId || !campaignNameInput.trim() || !testEmail.trim()) {
      setTestMessage("Campaign name, lead list, and test email are required.");
      return;
    }
    setTestSending(true);
    setTestMessage("");
    try {
      const res = await fetch("/api/instantly/send/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: campaign.leadBatchId,
          campaignName: campaignNameInput.trim(),
          testEmail: testEmail.trim(),
          campaignId: id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Test send failed");
      setTestMessage(data.message ?? `Test campaign sent to ${testEmail}. Check your inbox for each step as a separate email.`);
    } catch (e) {
      setTestMessage(e instanceof Error ? e.message : "Test send failed");
    } finally {
      setTestSending(false);
    }
  };

  const handleLaunch = async (opts?: { skipFailingLeads?: boolean }) => {
    if (!id || !campaign?.leadBatchId || !campaignNameInput.trim()) {
      setSendError("Campaign name and lead list are required.");
      return;
    }
    const accountCount = selectedAccountEmails?.length ?? instantlyAccounts.length;
    if (instantlyAccounts.length > 0 && accountCount === 0) {
      setSendError("Select at least one mailbox to send from.");
      return;
    }
    if (!opts?.skipFailingLeads && validation && !validation.canSend) {
      setSendError("Every lead must have a full sequence that passes. Run 'Generate sequences' until 100% pass, or use 'Skip failing leads & Launch'.");
      return;
    }
    setSending(true);
    setSendError("");
    try {
      const res = await fetch("/api/instantly/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: campaign.leadBatchId,
          campaignName: campaignNameInput.trim(),
          campaignId: id,
          accountEmails: selectedAccountEmails && selectedAccountEmails.length > 0 ? selectedAccountEmails : undefined,
          skipFailingLeads: opts?.skipFailingLeads ?? false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      setCampaign((c) => c ? { ...c, status: "launched" } : null);
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  if (guardLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }
  if (!session) {
    router.push("/login");
    return null;
  }
  if (!ready || !campaign) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Campaign not found.</p>
        <Link href="/dashboard" className="ml-2 text-[#1A7A4A]">Back to dashboard</Link>
      </div>
    );
  }

  const isLaunched = campaign.status === "launched";
  const leadCount = campaign.leadBatch?.leads?.length ?? 0;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      <header className="border-b bg-white flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-5xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-md flex items-center justify-center text-white text-xs font-bold" style={{ background: 'var(--accent)' }}>g</div>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>gather</span>
            </Link>
            <span style={{ color: 'var(--border-strong)' }}>/</span>
            <Link href="/dashboard" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Campaigns</Link>
          </div>
          <nav className="flex items-center gap-5 text-sm">
            <Link href="/onboarding" className="hover:text-gray-800" style={{ color: 'var(--text-tertiary)' }}>Settings</Link>
            <span style={{ color: 'var(--text-tertiary)' }}>{session.user?.email}</span>
            <button onClick={() => signOut({ callbackUrl: "/" })} className="hover:text-gray-800" style={{ color: 'var(--text-tertiary)' }}>Log out</button>
          </nav>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-10">
          <div className="flex items-center gap-4 mb-8">
            <Link href="/dashboard" className="text-gray-400 hover:text-gray-700">← Dashboard</Link>
            <h1 className="text-2xl font-semibold text-gray-900">{campaign.name}</h1>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isLaunched ? "bg-green-50 text-[#1A7A4A]" : "bg-gray-100 text-gray-500"
            }`}>{campaign.status}</span>
          </div>

          {isLaunched ? (
            <div className="space-y-6">
              <p className="text-gray-500">This campaign has been launched. Sent campaigns: {campaign.sentCampaigns.length}. Total leads: {leadCount}.</p>
              <div className="flex flex-wrap gap-3">
                {campaign.sentCampaigns?.length > 0 && (
                  <Link
                    href={`/dashboard/sent/${campaign.sentCampaigns[0].id}`}
                    className="inline-flex rounded-md bg-[#1A7A4A] px-4 py-2 text-sm font-medium text-white hover:bg-[#166640]"
                  >
                    View stats, emails & playbook →
                  </Link>
                )}
                <Link href="/dashboard" className="inline-flex rounded-md border border-zinc-600 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  Back to dashboard
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="flex gap-2 mb-8 border-b border-gray-200 pb-4">
                {(["playbook", "sequences", "send"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStep(s)}
                    className={`rounded-md px-4 py-2 text-sm font-medium capitalize ${
                      step === s ? "bg-gray-200 text-gray-900" : "text-gray-400 hover:text-gray-700"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {step === "playbook" && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-lg font-medium text-gray-800">Campaign context</h2>
                    <p className="mt-1 text-sm text-gray-400">
                      Tell the AI everything it needs to write great emails for this campaign — product angle, target pain points, tone, what to avoid, relevant URLs, case studies, notes from calls. The more context you give, the better the emails.
                    </p>
                  </div>

                  {playbookError && <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-600">{playbookError}</div>}

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-sm text-gray-500">Context &amp; guidelines</label>
                      <label className="flex items-center gap-1.5 cursor-pointer rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-500 hover:text-gray-800 hover:border-zinc-600">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                        Attach file
                        <input
                          type="file"
                          accept=".txt,.md,.csv,.json"
                          className="sr-only"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const text = await file.text();
                            setEditingGuidelines((g) => ({
                              ...g,
                              context: g.context
                                ? `${g.context}\n\n--- ${file.name} ---\n${text}`
                                : `--- ${file.name} ---\n${text}`,
                            }));
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                    <textarea
                      value={editingGuidelines.context}
                      onChange={(e) => setEditingGuidelines((g) => ({ ...g, context: e.target.value }))}
                      placeholder={`Examples of what to include:\n• Product angle: "We help CMOs run research in days, not weeks"\n• Tone: Direct and confident, no fluff, avoid buzzwords\n• Pain: Teams are stuck waiting months for insights from agencies\n• Step 1: Lead with a sharp question about their research process\n• Step 2: Drop a proof point — Datadog ran 3 studies in a week\n• Step 3: Low-friction CTA — offer a 15-min demo\n• URL: https://gatherhq.com/case-studies (include for context)\n• Avoid: Don't mention price, don't be pushy`}
                      rows={14}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2.5 text-gray-800 text-sm leading-relaxed font-mono resize-y"
                    />
                    <p className="mt-1.5 text-xs text-gray-300">
                      Tip: Paste URLs and the AI will use them as reference. Attach .txt / .md / .csv files with briefs, case studies, or talking points.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-start gap-6">
                    <div>
                      <label className="block text-sm text-gray-500 mb-1">Number of emails in sequence</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={editingGuidelines.numSteps}
                          onChange={(e) => {
                            const n = Math.min(10, Math.max(1, parseInt(e.target.value) || 1));
                            const baseDelays = [1, 3, 5, 7, 10, 14, 21, 28, 35, 42];
                            const newDelays = Array.from({ length: n }, (_, i) =>
                              editingGuidelines.stepDelays[i] ?? baseDelays[i] ?? (i * 7)
                            );
                            setEditingGuidelines((g) => ({ ...g, numSteps: n, stepDelays: newDelays }));
                          }}
                          className="w-20 rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-800 text-sm text-center"
                        />
                        <span className="text-xs text-gray-400">emails (1–10)</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-500 mb-1">Days between emails</label>
                      <div className="flex flex-wrap gap-2">
                        {editingGuidelines.stepDelays.map((d, i) => (
                          <div key={i} className="flex flex-col items-center gap-0.5">
                            <span className="text-xs text-gray-300">#{i + 1}</span>
                            <input
                              type="number"
                              min={0}
                              value={d}
                              onChange={(e) => setEditingGuidelines((g) => {
                                const arr = [...g.stepDelays];
                                arr[i] = Math.max(0, parseInt(e.target.value) || 0);
                                return { ...g, stepDelays: arr };
                              })}
                              className="w-14 rounded-md border border-gray-300 bg-white px-2 py-2 text-gray-800 text-sm text-center"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={savePlaybookAndNext}
                    disabled={savingPlaybook || !editingGuidelines.context.trim()}
                    className="rounded-md bg-[#1A7A4A] px-4 py-2 text-sm font-medium text-white hover:bg-[#166640] disabled:opacity-50"
                  >
                    {savingPlaybook ? "Saving…" : "Next: Add leads & generate sequences →"}
                  </button>

                  {/* Sample emails */}
                  <div className="border-t border-gray-200 pt-6">
                    <h3 className="text-sm font-medium text-gray-700 mb-1">Preview sample emails</h3>
                    <p className="text-xs text-gray-400 mb-3">
                      Generate example sequences to see what the AI will produce with your context.
                    </p>
                    <div className="flex flex-wrap items-end gap-3 mb-3">
                      <div className="min-w-[140px]">
                        <label className="block text-xs text-gray-400 mb-1">Job title (optional)</label>
                        <input
                          type="text"
                          value={sampleJobTitle}
                          onChange={(e) => setSampleJobTitle(e.target.value)}
                          placeholder="e.g. VP Sales"
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-800 text-sm"
                        />
                      </div>
                      <div className="min-w-[180px]">
                        <label className="block text-xs text-gray-400 mb-1">Company URL (optional)</label>
                        <input
                          type="text"
                          value={sampleCompanyUrl}
                          onChange={(e) => setSampleCompanyUrl(e.target.value)}
                          placeholder="e.g. acme.com or Acme Inc"
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-800 text-sm"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        setSamplesLoading(true);
                        setSampleError("");
                        try {
                          const res = await fetch("/api/playbook/samples", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              campaignId: id,
                              guidelines: editingGuidelines,
                              customLead: (sampleJobTitle.trim() || sampleCompanyUrl.trim())
                                ? { jobTitle: sampleJobTitle.trim() || undefined, companyUrl: sampleCompanyUrl.trim() || undefined }
                                : undefined,
                            }),
                          });
                          const data = await res.json();
                          if (data.samples) {
                            setSamples(data.samples);
                            setSampleError("");
                          } else {
                            throw new Error(data.error || "Failed to generate");
                          }
                        } catch (e) {
                          setSamples([]);
                          setSampleError(e instanceof Error ? e.message : "Failed to generate samples");
                        } finally {
                          setSamplesLoading(false);
                        }
                      }}
                      disabled={samplesLoading || !editingGuidelines.context.trim()}
                      className="rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-zinc-600 disabled:opacity-50"
                    >
                      {samplesLoading ? "Generating…" : "Generate sample emails"}
                    </button>
                    {sampleError && (
                      <p className="mt-2 text-sm text-amber-600">{sampleError}</p>
                    )}
                    {samples.length > 0 && (
                      <div className="mt-4 space-y-4">
                        {samples.map((sample, si) => (
                          <div key={si} className="rounded-lg border border-gray-200 p-4">
                            <p className="text-sm font-medium text-gray-700 mb-2">
                              {sample.persona}
                              {sample.exampleLead && (
                                <span className="text-gray-400 font-normal ml-2">
                                  — {sample.exampleLead.name}, {sample.exampleLead.company}
                                </span>
                              )}
                            </p>
                            <div className="space-y-3">
                              {sample.steps.map((step, i) => (
                                <div key={i} className="rounded border border-gray-300 p-3 text-sm">
                                  <p className="text-gray-400 font-medium">Step {i + 1}: {step.subject || "(no subject)"}</p>
                                  <pre className="mt-2 text-gray-700 whitespace-pre-wrap font-sans text-sm break-words">
                                    {step.body || "(no body)"}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}


              {step === "sequences" && (
                <div className="space-y-4">
                  <h2 className="text-lg font-medium text-gray-800">Leads & sequences</h2>
                  <p className="text-sm text-gray-400">Import leads from a CSV file, paste raw CSV text, or pull from Google Sheets. Then generate personalized email sequences for each lead.</p>

                  {/* CSV section */}
                  <div className="rounded-lg border border-gray-200 bg-white/30 p-4 space-y-3">
                    <h3 className="text-sm font-medium text-gray-700">CSV import</h3>
                    <p className="text-xs text-gray-400">Expected columns: email, name, company, job title, website (any order, extra columns ignored).</p>

                    {/* Row 1: file upload + process paste buttons */}
                    <div className="flex flex-wrap gap-2 items-center">
                      {/* File upload */}
                      <label className="flex items-center gap-2 cursor-pointer rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1A7A4A]">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        Upload CSV
                        <input
                          type="file"
                          accept=".csv,.txt"
                          className="sr-only"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const text = await file.text();
                            setCsvFileName(file.name);
                            setCsvInput(text);
                            setUploadError("");
                            e.target.value = "";
                          }}
                        />
                      </label>

                      {/* Process paste button */}
                      <button
                        onClick={() => handleUpload()}
                        disabled={uploading || !csvInput.trim()}
                        className="rounded-md bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-zinc-600 disabled:opacity-50"
                      >
                        {uploading ? "Processing…" : "Process CSV"}
                      </button>

                      {csvFileName && (
                        <span className="text-xs text-[#1A7A4A] flex items-center gap-1">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {csvFileName} loaded
                        </span>
                      )}
                    </div>

                    {/* Paste area */}
                    <textarea
                      value={csvInput}
                      onChange={(e) => { setCsvInput(e.target.value); setCsvFileName(null); }}
                      placeholder={"email,name,company,job title,website\njane@acme.com,Jane,Acme,VP Sales,acme.com"}
                      rows={3}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-800 text-sm font-mono"
                    />
                    <p className="text-xs text-gray-300">Upload a file to auto-fill above, then hit Process CSV — or paste raw text directly and Process CSV.</p>
                    {uploadError && (
                      <div className="space-y-2">
                        <p className="text-sm text-red-500">{uploadError}</p>
                        {uploadError.toLowerCase().includes("duplicate") && (
                          <button
                            onClick={() => handleUpload(true)}
                            disabled={uploading}
                            className="text-xs px-3 py-1.5 rounded-md border border-amber-200 text-amber-700 hover:bg-amber-900/30 disabled:opacity-50"
                          >
                            {uploading ? "Uploading…" : "Force re-upload (ignore duplicates)"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Google Sheets section */}
                  <div className="rounded-lg border border-gray-200 bg-white/30 p-4 space-y-3">
                    <h3 className="text-sm font-medium text-gray-700">Google Sheets import</h3>
                    <p className="text-xs text-gray-400">
                      Sheet must be set to <span className="text-gray-700">"Anyone with the link can view"</span> — open it, then File → Share → Change to Anyone with the link.
                    </p>
                    <div className="flex flex-wrap gap-2 items-center">
                      <input
                        type="url"
                        value={sheetUrl}
                        onChange={(e) => setSheetUrl(e.target.value)}
                        placeholder="https://docs.google.com/spreadsheets/d/…"
                        className="flex-1 min-w-[260px] rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-800 text-sm"
                      />
                      <button
                        onClick={handleSheetImport}
                        disabled={sheetImporting || !sheetUrl.trim()}
                        className="rounded-md bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-zinc-600 disabled:opacity-50 whitespace-nowrap"
                      >
                        {sheetImporting ? "Importing…" : "Import from Sheet"}
                      </button>
                    </div>
                    {sheetError && <p className="text-sm text-red-500">{sheetError}</p>}
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">Or select existing list</label>
                    <select
                      value={selectedBatchId ?? ""}
                      onChange={(e) => setSelectedBatchId(e.target.value || null)}
                      className="rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-800 text-sm"
                    >
                      <option value="">Select batch</option>
                      {batches.map((b) => (
                        <option key={b.id} value={b.id}>{b.name ?? b.id} ({b.leadCount} leads)</option>
                      ))}
                    </select>
                  </div>
                  {generateProgress && generateProgress.total > 0 && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-gray-500">
                        <span>{generating ? "Generating sequences…" : "Progress"}</span>
                        <span>{generateProgress.generated} of {generateProgress.total}</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full bg-[#1A7A4A] transition-all duration-300"
                          style={{ width: `${(100 * generateProgress.generated) / generateProgress.total}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {generateError && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-medium text-amber-700">Generation failed</p>
                      <p className="mt-1 text-sm text-amber-800/90">{generateError}</p>
                      <p className="mt-3 text-sm text-gray-500">
                        <strong>What to do next:</strong> Click &quot;Generate all sequences & Next&quot; again to resume from where it stopped. Progress is saved. If it keeps failing, try a smaller batch or check Settings for API keys.
                      </p>
                    </div>
                  )}
                  <div className="rounded-lg border border-gray-200 bg-white/80 p-4">
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Enhancement options</h3>
                    <p className="text-xs text-gray-400 mb-3">Give the AI more context and tools for richer emails.</p>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useWebScraping}
                          onChange={(e) => setUseWebScraping(e.target.checked)}
                          className="rounded border-zinc-600 bg-gray-100 text-emerald-600 focus:ring-emerald-500"
                        />
                        Web scraping — fetch company website for context (requires website column in CSV)
                      </label>
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useLandingPage}
                          onChange={(e) => setUseLandingPage(e.target.checked)}
                          className="rounded border-zinc-600 bg-gray-100 text-emerald-600 focus:ring-emerald-500"
                        />
                        Personalized landing page — unique link per lead with AI-generated research brief
                      </label>
                      {useLandingPage && (
                        <div className="ml-6 mt-1 space-y-1">
                          <label className="block text-xs text-gray-400">
                            CTA URL <span className="text-gray-300">(where the page button links — e.g. your Calendly)</span>
                          </label>
                          <input
                            type="url"
                            value={ctaUrl}
                            onChange={(e) => setCtaUrl(e.target.value)}
                            onBlur={() => {
                              if (!id) return;
                              fetch(`/api/campaigns/${id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ ctaUrl: ctaUrl.trim() }),
                              }).catch(() => {});
                            }}
                            placeholder="https://calendly.com/you/demo"
                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
                          />
                        </div>
                      )}
                      {(hasLumaKey || hasRunwayKey) && (
                        <>
                          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={useVideo}
                              onChange={(e) => setUseVideo(e.target.checked)}
                              className="rounded border-zinc-600 bg-gray-100 text-emerald-600 focus:ring-emerald-500"
                            />
                            AI video — include personalized video link (generate videos first, then sequences)
                          </label>
                          <div className="flex items-center gap-2">
                            <select
                              value={videoProvider}
                              onChange={(e) => setVideoProvider(e.target.value as "luma" | "runway")}
                              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-800 text-sm"
                            >
                              {hasLumaKey && <option value="luma">Luma</option>}
                              {hasRunwayKey && <option value="runway">Runway</option>}
                            </select>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!selectedBatchId || generatingVideos) return;
                                const prov = hasLumaKey && videoProvider === "luma" ? "luma" : hasRunwayKey ? "runway" : null;
                                if (!prov) return;
                                setGeneratingVideos(true);
                                setGenerateError("");
                                try {
                                  const batchRes = await fetch(`/api/leads/batch/${selectedBatchId}`);
                                  const batchData = await batchRes.json();
                                  if (!batchRes.ok) throw new Error(batchData.error || "Failed to fetch leads");
                                  const leads = (batchData.leads ?? []).filter((l: { videoUrl?: string }) => !l.videoUrl).slice(0, 3);
                                  if (leads.length === 0) {
                                    setGenerateError("All leads already have videos, or no leads in batch.");
                                    return;
                                  }
                                  for (const lead of leads) {
                                    const startRes = await fetch("/api/leads/video", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ leadId: lead.id, provider: prov }),
                                    });
                                    if (!startRes.ok) {
                                      const d = await startRes.json();
                                      throw new Error(d.error || "Failed to start video");
                                    }
                                    for (let i = 0; i < 60; i++) {
                                      await new Promise((r) => setTimeout(r, 5000));
                                      const statusRes = await fetch(`/api/leads/video?leadId=${encodeURIComponent(lead.id)}`);
                                      const statusData = await statusRes.json();
                                      if (statusData.status === "completed") break;
                                      if (statusData.status === "failed") throw new Error("Video generation failed");
                                    }
                                  }
                                } catch (e) {
                                  const errMsg = e instanceof Error ? e.message : "Video generation failed";
                                  setGenerateError(errMsg);
                                  try {
                                    await fetch("/api/feedback/error", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        context: "Video generation failed",
                                        error: errMsg,
                                        extra: { batchId: selectedBatchId, provider: prov },
                                      }),
                                    });
                                  } catch {
                                    //
                                  }
                                } finally {
                                  setGeneratingVideos(false);
                                }
                              }}
                              disabled={generatingVideos || !selectedBatchId}
                              className="rounded-md border border-zinc-600 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                            >
                              {generatingVideos ? "Generating…" : "Generate videos (first 3)"}
                            </button>
                          </div>
                        </>
                      )}
                      <p className="text-xs text-gray-400">
                        Sora — invitation-only. Luma & Runway — add API key in Settings.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={generateAll}
                    disabled={!selectedBatchId || generating}
                    className="rounded-md bg-[#1A7A4A] px-4 py-2 text-sm font-medium text-white hover:bg-[#166640] disabled:opacity-50"
                  >
                    {generating ? "Generating…" : "Generate all sequences & Next"}
                  </button>
                  <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useFastModel}
                      onChange={(e) => setUseFastModel(e.target.checked)}
                      className="rounded border-zinc-600 bg-gray-100 text-emerald-600 focus:ring-emerald-500"
                    />
                    Use fast model (Haiku — faster, good quality)
                  </label>
                </div>
              )}

              {step === "send" && (
                <div className="space-y-6">
                  <h2 className="text-lg font-medium text-gray-800">Configure & launch</h2>
                  <p className="text-sm text-gray-400">Each step goes out as a separate email. Verify quality and send a test first.</p>

                  {/* Email quality check — every lead must have full N-step sequence */}
                  <div className="rounded-lg border border-gray-200 bg-white/60 p-4">
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Email quality check</h3>
                    <p className="text-xs text-gray-400 mb-3">Every lead must have a personalized {validation?.numSteps ?? "N"}-step sequence (subject ≥10 chars, body ≥50 chars per step). No blank emails. Run &quot;Generate sequences&quot; until 100% pass.</p>
                    {validationLoading ? (
                      <p className="text-sm text-gray-400">Loading…</p>
                    ) : validation?.steps?.length ? (
                      <ul className="space-y-2">
                        {(validation.leadsWithNoContent ?? 0) > 0 && (
                          <li className="text-amber-600 text-sm">
                            {validation.leadsWithNoContent} lead(s) have no sequence yet. Go to Sequences and run &quot;Generate sequences&quot; until every lead is done.
                          </li>
                        )}
                        {validation.steps.map((s) => (
                          <li key={s.step} className="flex items-center gap-3 text-sm">
                            {s.passedAllLeads ? (
                              <span className="text-[#1A7A4A] font-medium" title="Passed">✓</span>
                            ) : (
                              <span className="text-amber-600 font-medium" title="Some leads fail">✗</span>
                            )}
                            <span className="text-gray-700">Email step {s.step}</span>
                            {s.passedAllLeads ? (
                              <span className="text-gray-400">Passed ({validation.totalLeads} leads)</span>
                            ) : (
                              <span className="text-amber-600">{s.failed} lead(s) fail — {s.sampleFailures?.[0] ?? "regenerate or fix"}</span>
                            )}
                          </li>
                        ))}
                        <li className="text-gray-400 text-xs mt-2">
                          {validation.canSend
                            ? `All ${validation.leadsPassingAllSteps} leads ready. Each of ${validation.numSteps} steps goes out as a separate email.`
                            : `Every lead must pass. ${validation.leadsPassingAllSteps} of ${validation.totalLeads} pass. Run "Generate sequences" until 100% pass.`}
                        </li>
                        {diagnose && !validation.canSend && (
                          <li className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                            <p className="font-medium">Why: {diagnose.verdict}</p>
                            {diagnose.sampleProblems.length > 0 && (
                              <ul className="mt-1 space-y-0.5 text-amber-700/70">
                                {diagnose.sampleProblems.slice(0, 4).map((p, i) => <li key={i} className="font-mono truncate">• {p}</li>)}
                              </ul>
                            )}
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="text-sm text-gray-400">Select a lead list and generate sequences to see the check.</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm text-gray-500 mb-1">Campaign name</label>
                    <input
                      value={campaignNameInput}
                      onChange={(e) => setCampaignNameInput(e.target.value)}
                      placeholder="e.g. Q1 Outbound"
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-800 text-sm"
                    />
                  </div>

                  {/* Test campaign — send multi-step to one email */}
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <h3 className="text-sm font-medium text-amber-800 mb-2">Test campaign first</h3>
                    <p className="text-xs text-gray-400 mb-3">Creates a test campaign with 2-min delays. Emails send when Instantly's schedule allows (Mon–Fri, 9am–5pm). Check your Instantly dashboard and inbox (including spam).</p>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="flex-1 min-w-[200px]">
                        <label className="block text-xs text-gray-400 mb-1">Test email</label>
                        <input
                          type="email"
                          value={testEmail}
                          onChange={(e) => setTestEmail(e.target.value)}
                          placeholder="you@example.com"
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-800 text-sm"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleTestCampaign}
                        disabled={testSending || !campaignNameInput.trim() || !campaign.leadBatchId || !testEmail.trim()}
                        className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
                      >
                        {testSending ? "Sending test…" : "Send test to my email"}
                      </button>
                    </div>
                    {testMessage && (
                      <p className={`mt-3 text-sm ${testMessage.startsWith("Test campaign") || testMessage.includes("Check your inbox") ? "text-[#1A7A4A]" : "text-amber-600"}`}>
                        {testMessage}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm text-gray-500 mb-1">Instantly accounts</label>
                    {accountsLoading ? (
                      <p className="text-gray-400 text-sm">Loading…</p>
                    ) : instantlyAccounts.length === 0 ? (
                      <p className="text-sm text-gray-400">Add your Instantly API key in Settings to see accounts.</p>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={accountSearch}
                            onChange={(e) => setAccountSearch(e.target.value)}
                            placeholder="Search mailboxes…"
                            className="flex-1 min-w-[180px] rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-800 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => setSelectedAccountEmails(instantlyAccounts.map((a) => a.email))}
                            className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100"
                          >
                            Select all
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedAccountEmails([])}
                            className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100"
                          >
                            Unselect all
                          </button>
                        </div>
                        <p className="text-xs text-gray-400">
                          {(selectedAccountEmails === null ? instantlyAccounts.length : selectedAccountEmails.length)} of {instantlyAccounts.length} selected
                        </p>
                        {(() => {
                          const filtered = instantlyAccounts.filter(
                            (a) => !accountSearch.trim() || a.email.toLowerCase().includes(accountSearch.toLowerCase())
                          );
                          const domainMap = new Map<string, string[]>();
                          for (const a of filtered) {
                            const domain = a.email.includes("@") ? a.email.split("@")[1]?.toLowerCase() ?? "unknown" : "unknown";
                            if (!domainMap.has(domain)) domainMap.set(domain, []);
                            domainMap.get(domain)!.push(a.email);
                          }
                          const domains = Array.from(domainMap.entries()).sort((a, b) => b[1].length - a[1].length);
                          return domains.length > 1 ? (
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              {domains.map(([domain, emails]) => {
                                const selected = selectedAccountEmails ?? [];
                                const selectedInDomain = emails.filter((e) => selected.includes(e)).length;
                                const allSelected = selectedInDomain === emails.length;
                                return (
                                  <button
                                    key={domain}
                                    type="button"
                                    onClick={() => {
                                      setSelectedAccountEmails((prev) => {
                                        const current = prev ?? [];
                                        if (allSelected) {
                                          return current.filter((e) => !emails.includes(e));
                                        }
                                        const added = new Set(current);
                                        emails.forEach((e) => added.add(e));
                                        return Array.from(added);
                                      });
                                    }}
                                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                                      allSelected
                                        ? "bg-[#1A7A4A]/80 text-white hover:bg-[#166640]"
                                        : "bg-gray-200/80 text-gray-700 hover:bg-zinc-600"
                                    }`}
                                    title={allSelected ? `Unselect all ${emails.length} from ${domain}` : `Select all ${emails.length} from ${domain}`}
                                  >
                                    {domain} ({emails.length})
                                  </button>
                                );
                              })}
                            </div>
                          ) : null;
                        })()}
                        <div className="max-h-48 overflow-y-auto rounded-md border border-gray-300 bg-white/80 p-2 space-y-1">
                          {instantlyAccounts
                            .filter((a) => !accountSearch.trim() || a.email.toLowerCase().includes(accountSearch.toLowerCase()))
                            .map((a) => {
                              const isSelected = (selectedAccountEmails ?? []).includes(a.email);
                              return (
                                <label key={a.email} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-100/50 cursor-pointer text-sm">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedAccountEmails((prev) => [...(prev ?? []), a.email]);
                                      } else {
                                        setSelectedAccountEmails((prev) => (prev ?? []).filter((em) => em !== a.email));
                                      }
                                    }}
                                    className="rounded border-zinc-600 bg-gray-100 text-emerald-600 focus:ring-emerald-500"
                                  />
                                  <span className="text-gray-700 truncate">{a.email}</span>
                                </label>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>
                  {sendError && (
                    <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600 space-y-2">
                      <p>{sendError}</p>
                      {diagnose && <p className="text-xs text-red-500/80 font-medium">Diagnosis: {diagnose.verdict}</p>}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => handleLaunch()}
                      disabled={sending || !campaignNameInput.trim() || !campaign.leadBatchId || (validation != null && !validation.canSend) || (instantlyAccounts.length > 0 && (selectedAccountEmails?.length ?? 0) === 0)}
                      className="rounded-md bg-[#1A7A4A] px-4 py-2 text-sm font-medium text-white hover:bg-[#166640] disabled:opacity-50"
                    >
                      {sending ? "Launching…" : "Launch campaign"}
                    </button>
                    {validation && !validation.canSend && (validation.leadsPassingAllSteps ?? 0) > 0 && (
                      <button
                        onClick={() => handleLaunch({ skipFailingLeads: true })}
                        disabled={sending || !campaignNameInput.trim() || !campaign.leadBatchId || (instantlyAccounts.length > 0 && (selectedAccountEmails?.length ?? 0) === 0)}
                        className="rounded-md border border-amber-200 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-900/30 disabled:opacity-50"
                      >
                        {sending ? "Launching…" : `Skip ${(validation.totalLeads ?? 0) - (validation.leadsPassingAllSteps ?? 0)} failing leads & Launch`}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
