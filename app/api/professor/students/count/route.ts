import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });
  const termId = req.nextUrl.searchParams.get("term_id");

  const params: unknown[] = [uid];
  const termFilter = termId ? (params.push(parseInt(termId)), `AND c.term_id = $${params.length}`) : "";

  const rows = await profQuery<{ count: string }>(
    `SELECT COUNT(DISTINCT e.student_id) AS count
     FROM prof_enrollments e
     JOIN prof_courses c ON c.id = e.course_id AND c.user_id = $1 ${termFilter}
     WHERE e.user_id = $1`,
    params
  );

  return NextResponse.json({ count: parseInt(rows[0]?.count ?? "0") });
}
