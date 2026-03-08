import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";

const AGENT_URL = process.env.CHENS_AGENT_URL!;
const AGENT_KEY = process.env.CHENS_AGENT_KEY!;

async function proxyToAgent(path: string, method: string, body?: object) {
  const res = await fetch(`${AGENT_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-api-key": AGENT_KEY },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

// POST /api/agent/tasks — submit a task to the agent
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const body = await req.json();
  const data = await proxyToAgent("/tasks", "POST", body);
  return NextResponse.json(data, { status: 202 });
}

// GET /api/agent/tasks — list tasks
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const data = await proxyToAgent("/tasks", "GET");
  return NextResponse.json(data);
}
