import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const agentUrl = process.env.CHENS_AGENT_URL ?? "https://chens-agent.fly.dev";
  const agentKey = process.env.CHENS_AGENT_KEY!;

  const res = await fetch(`${agentUrl}/grade/process-queue`, {
    method: "POST",
    headers: { "x-api-key": agentKey },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
