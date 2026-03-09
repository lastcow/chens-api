import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const [user] = await profQuery<{
    id: string; name: string; email: string; role: string; image: string | null;
    has_password: boolean; created_at: string;
  }>(
    `SELECT id, name, email, role, image,
       (password IS NOT NULL) AS has_password,
       "createdAt" AS created_at
     FROM "User" WHERE id = $1`,
    [uid]
  );

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // OAuth providers
  const accounts = await profQuery<{ provider: string }>(
    `SELECT provider FROM "Account" WHERE "userId" = $1`,
    [uid]
  );
  const providers = accounts.map(a => a.provider);

  // Cost summary
  const [costs] = await profQuery<{
    total_cost: string; month_cost: string; total_runs: string; month_runs: string;
  }>(
    `SELECT
       COALESCE(SUM(cost_usd), 0)::text AS total_cost,
       COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= date_trunc('month', now())), 0)::text AS month_cost,
       COUNT(*)::text AS total_runs,
       COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now()))::text AS month_runs
     FROM agent_runs WHERE user_id = $1`,
    [uid]
  );

  return NextResponse.json({
    user: { ...user, providers },
    costs: {
      total: parseFloat(costs?.total_cost ?? "0"),
      month: parseFloat(costs?.month_cost ?? "0"),
      total_runs: parseInt(costs?.total_runs ?? "0"),
      month_runs: parseInt(costs?.month_runs ?? "0"),
    },
  });
}
