import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// One-time migration endpoint — delete this file after running
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("secret") !== process.env.NEXTAUTH_SECRET?.slice(0, 8)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "landingPageContentJson" TEXT`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "ctaUrl" TEXT`
    );
    return NextResponse.json({ ok: true, message: "Migration complete — columns added." });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message }, { status: 500 });
  }
}
