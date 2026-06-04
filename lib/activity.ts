import { prisma } from "@/lib/prisma";
import { sendNotificationEmail } from "@/lib/email";

export type ActivityType =
  | "generate"
  | "send"
  | "ingest"
  | "experiment"
  | "reply"
  | "autopilot"
  | "info";

/**
 * Append a row to the workspace activity log. Best-effort: never throws into
 * the caller (logging must not break the action it's recording).
 */
export async function logActivity(
  workspaceId: string,
  type: ActivityType,
  message: string,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        workspaceId,
        type,
        message,
        metaJson: meta ? JSON.stringify(meta) : null,
      },
    });
  } catch (err) {
    console.warn("[activity] log failed:", err instanceof Error ? err.message : err);
  }

  // Optional: email the operator on every event (best-effort, never blocks)
  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { notifyOnActivity: true, notifyEmail: true, user: { select: { email: true } } },
    });
    if (ws?.notifyOnActivity) {
      const to = ws.notifyEmail ?? ws.user?.email;
      if (to) {
        const metaLine = meta
          ? Object.entries(meta)
              .filter(([, v]) => typeof v === "number" || typeof v === "string")
              .map(([k, v]) => `<strong>${k}:</strong> ${v}`)
              .join(" &middot; ")
          : "";
        await sendNotificationEmail(
          to,
          `[Engine · ${type}] ${message}`,
          `<p>${message}</p>${metaLine ? `<p style="color:#666;font-size:13px">${metaLine}</p>` : ""}`
        );
      }
    }
  } catch (err) {
    console.warn("[activity] notify failed:", err instanceof Error ? err.message : err);
  }
}
