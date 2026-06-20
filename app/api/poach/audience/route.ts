import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { competitorAudienceCsv } from "@/lib/competitor-targets";

export const dynamic = "force-dynamic";

/** GET: competitor company list as a LinkedIn matched-audience CSV. ?b2c=1 for consumer brands only. */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b2cOnly = new URL(request.url).searchParams.get("b2c") === "1";
  const csv = competitorAudienceCsv(b2cOnly);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="competitor-poach-audience${b2cOnly ? "-b2c" : ""}.csv"`,
    },
  });
}
