import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

// GET /api/professor/grade-staging?request_id=xxx — get staging grades for a request
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const requestId = req.nextUrl.searchParams.get("request_id");
  if (!requestId) return NextResponse.json({ error: "Missing request_id" }, { status: 400 });

  const rows = await profQuery(
    `SELECT * FROM prof_grade_staging
     WHERE request_id = $1 AND user_id = $2
     ORDER BY student_name`,
    [requestId, uid]
  );
  return NextResponse.json({ grades: rows });
}

// POST /api/professor/grade-staging — submit grades to final (approve staging)
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const { request_id, action } = await req.json();
  if (!request_id || !action) {
    return NextResponse.json({ error: "Missing request_id or action" }, { status: 400 });
  }

  if (action === "approve") {
    // Move staging grades to prof_grades, update request status
    await profQuery(
      `INSERT INTO prof_grades (submission_id, raw_score, final_score, late_penalty, grader_comment, graded_by, canvas_posted, user_id)
       SELECT gs.submission_id, gs.raw_score, gs.final_score, gs.late_penalty, gs.grader_comment, 'ai', false, gs.user_id
       FROM prof_grade_staging gs
       WHERE gs.request_id = $1 AND gs.user_id = $2 AND gs.status = 'pending' AND gs.submission_id IS NOT NULL
       ON CONFLICT (submission_id) DO UPDATE
         SET raw_score = EXCLUDED.raw_score,
             final_score = EXCLUDED.final_score,
             late_penalty = EXCLUDED.late_penalty,
             grader_comment = EXCLUDED.grader_comment,
             graded_by = 'ai',
             graded_at = now()`,
      [request_id, uid]
    );
    await profQuery(
      `UPDATE prof_grade_staging SET status = 'approved', updated_at = now() WHERE request_id = $1 AND user_id = $2`,
      [request_id, uid]
    );
    await profQuery(
      `UPDATE prof_requests SET status = 'completed' WHERE id = $1 AND user_id = $2`,
      [request_id, uid]
    );
  } else if (action === "reject") {
    await profQuery(
      `UPDATE prof_grade_staging SET status = 'rejected', updated_at = now() WHERE request_id = $1 AND user_id = $2`,
      [request_id, uid]
    );
    await profQuery(
      `UPDATE prof_requests SET status = 'cancelled' WHERE id = $1 AND user_id = $2`,
      [request_id, uid]
    );
  }

  return NextResponse.json({ ok: true });
}
