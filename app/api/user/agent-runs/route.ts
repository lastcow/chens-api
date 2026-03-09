import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const page = parseInt(req.nextUrl.searchParams.get("page") ?? "1");
  const limit = 20;
  const offset = (page - 1) * limit;

  const runs = await profQuery<{
    id: number; model: string; provider: string; task_type: string;
    input_tokens: number; output_tokens: number; cost_usd: string; created_at: string;
  }>(
    `SELECT id, model, provider, task_type, input_tokens, output_tokens,
            cost_usd::text, created_at
     FROM agent_runs WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [uid, limit, offset]
  );

  // Monthly breakdown by model
  const breakdown = await profQuery<{ model: string; total_cost: string; runs: string }>(
    `SELECT model, SUM(cost_usd)::text AS total_cost, COUNT(*)::text AS runs
     FROM agent_runs
     WHERE user_id = $1 AND created_at >= date_trunc('month', now())
     GROUP BY model ORDER BY SUM(cost_usd) DESC`,
    [uid]
  );

  return NextResponse.json({ runs, breakdown });
}

// Log a new run (called internally by ChensAgent)
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const body = await req.json();
  const { model, provider, task_type, input_tokens, output_tokens, cost_usd, metadata } = body;

  const [run] = await profQuery<{ id: number }>(
    `INSERT INTO agent_runs (user_id, model, provider, task_type, input_tokens, output_tokens, cost_usd, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [uid, model ?? null, provider ?? null, task_type ?? null,
     input_tokens ?? 0, output_tokens ?? 0, cost_usd ?? 0, metadata ? JSON.stringify(metadata) : null]
  );

  return NextResponse.json({ id: run.id });
}
