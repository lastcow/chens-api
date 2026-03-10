import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

// GET /api/professor/grade-config — public config for grading (cost etc.)
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const rows = await profQuery<{ key: string; value: string }>(
    `SELECT key, value FROM prof_config WHERE key = 'grading_cost_per_submission'`, []
  );

  const cost = rows[0]?.value ?? "0.05";
  return NextResponse.json({ grading_cost_per_submission: parseFloat(cost) });
}
