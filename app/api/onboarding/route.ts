import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const domain = typeof body.domain === "string" ? body.domain.trim() : "";
    const anthropicKey = typeof body.anthropicKey === "string" ? body.anthropicKey.trim() : "";
    const instantlyKey = typeof body.instantlyKey === "string" ? body.instantlyKey.trim() : "";
    const lumaApiKey = typeof body.lumaApiKey === "string" ? body.lumaApiKey.trim() : "";
    const runwayApiKey = typeof body.runwayApiKey === "string" ? body.runwayApiKey.trim() : "";
    const senderName = typeof body.senderName === "string" ? body.senderName.trim() || null : null;
    const similarCompanies = typeof body.similarCompanies === "string" ? body.similarCompanies.trim() || null : null;
    const referralPhrase = typeof body.referralPhrase === "string" ? body.referralPhrase.trim() || null : null;
    // Optional manual product summary + ICP (otherwise productSummary comes from the domain crawl)
    const productSummary = typeof body.productSummary === "string" ? body.productSummary.trim() : undefined;
    const icp = typeof body.icp === "string" ? body.icp.trim() : undefined;

    if (!domain) {
      return NextResponse.json(
        { error: "Domain is required" },
        { status: 400 }
      );
    }

    // Validate domain format (basic check)
    const domainRegex = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i;
    if (!domainRegex.test(domain)) {
      return NextResponse.json(
        { error: "Invalid domain format" },
        { status: 400 }
      );
    }

    // Encrypt API keys only when provided (keys are optional so users can explore first)
    const encryptedAnthropicKey = anthropicKey ? encrypt(anthropicKey) : null;
    const encryptedInstantlyKey = instantlyKey ? encrypt(instantlyKey) : null;
    const encryptedLumaKey = lumaApiKey ? encrypt(lumaApiKey) : null;
    const encryptedRunwayKey = runwayApiKey ? encrypt(runwayApiKey) : null;

    const socialProofJson =
      (similarCompanies?.trim() || referralPhrase?.trim())
        ? JSON.stringify({ similarCompanies: similarCompanies ?? "", referralPhrase: referralPhrase ?? "" })
        : null;

    // Upsert workspace (create or update). Keys optional: on update only set keys when non-empty (don't wipe when form sends empty).
    const workspace = await prisma.workspace.upsert({
      where: { userId: session.user.id },
      update: {
        domain,
        ...(senderName !== undefined && { senderName }),
        socialProofJson,
        ...(productSummary !== undefined && productSummary !== "" && { productSummary }),
        ...(icp !== undefined && icp !== "" && { icp }),
        ...(anthropicKey && { anthropicKey: encryptedAnthropicKey }),
        ...(instantlyKey && { instantlyKey: encryptedInstantlyKey }),
        ...(lumaApiKey && { lumaApiKey: encryptedLumaKey }),
        ...(runwayApiKey && { runwayApiKey: encryptedRunwayKey }),
      },
      create: {
        userId: session.user.id,
        domain,
        senderName: senderName ?? null,
        socialProofJson,
        ...(productSummary ? { productSummary } : {}),
        ...(icp ? { icp } : {}),
        anthropicKey: encryptedAnthropicKey,
        instantlyKey: encryptedInstantlyKey,
        lumaApiKey: encryptedLumaKey,
        runwayApiKey: encryptedRunwayKey,
      },
    });

    return NextResponse.json(
      { message: "Onboarding data saved successfully", workspaceId: workspace.id },
      { status: 200 }
    );
  } catch (error) {
    console.error("Onboarding error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const row = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: {
        id: true,
        domain: true,
        productSummary: true,
        icp: true,
        anthropicModel: true,
        senderName: true,
        socialProofJson: true,
        createdAt: true,
        updatedAt: true,
        anthropicKey: true,
        instantlyKey: true,
        lumaApiKey: true,
        runwayApiKey: true,
      },
    });

    if (!row) {
      return NextResponse.json({ workspace: null }, { status: 200 });
    }

    const { anthropicKey: _ak, instantlyKey: _ik, lumaApiKey: _lk, runwayApiKey: _rk, ...rest } = row;
    const workspace = {
      ...rest,
      hasAnthropicKey: Boolean(_ak),
      hasInstantlyKey: Boolean(_ik),
      hasLumaKey: Boolean(_lk),
      hasRunwayKey: Boolean(_rk),
    };

    return NextResponse.json({ workspace }, { status: 200 });
  } catch (error) {
    console.error("Get workspace error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
