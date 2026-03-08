import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";

const AGENT_URL = process.env.CHENS_AGENT_URL!;
const AGENT_KEY = process.env.CHENS_AGENT_KEY!;

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const res = await fetch(`${AGENT_URL}/tools`, { headers: { "x-api-key": AGENT_KEY } });
  return NextResponse.json(await res.json());
}
