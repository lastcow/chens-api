import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const terms = await profQuery<{
    id: number; canvas_id: number; name: string; is_current: boolean; start_at: string | null; end_at: string | null;
  }>(
    `SELECT id, canvas_id, name, is_current, start_at, end_at
     FROM prof_terms WHERE user_id = $1
     ORDER BY canvas_id DESC`,
    [uid]
  );

  const current = terms.find(t => t.is_current) ?? terms[0] ?? null;
  return NextResponse.json({ terms, current });
}
