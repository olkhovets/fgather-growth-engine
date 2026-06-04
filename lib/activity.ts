import { prisma } from "@/lib/prisma";

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
}
