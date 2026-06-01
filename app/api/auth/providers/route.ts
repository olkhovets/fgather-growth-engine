import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET: Returns which auth providers are enabled (e.g. for showing "Continue with Google").
 * No auth required.
 */
export async function GET() {
  const googleEnabled = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );
  return NextResponse.json({ google: googleEnabled });
}
