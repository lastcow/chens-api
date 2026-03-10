import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

// GET /api/user/credits — balance + transaction history
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const page  = parseInt(req.nextUrl.searchParams.get("page") ?? "1");
  const limit = 20;
  const offset = (page - 1) * limit;

  const balRows = await profQuery<{ credits: string }>(
    `SELECT COALESCE(credits, 0)::text AS credits FROM user_profile WHERE user_id = $1`, [uid]
  );
  const balance = parseFloat(balRows[0]?.credits ?? "0");

  const txRows = await profQuery<{
    id: number; type: string; amount: string; description: string | null;
    ref_id: string | null; balance_after: string | null; created_at: string;
  }>(
    `SELECT id, type, amount::text, description, ref_id, balance_after::text, created_at
     FROM credit_transactions WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [uid, limit, offset]
  );

  const totalRows = await profQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM credit_transactions WHERE user_id = $1`, [uid]
  );

  return NextResponse.json({
    balance,
    transactions: txRows,
    total: parseInt(totalRows[0]?.count ?? "0"),
    page,
  });
}
