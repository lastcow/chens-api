import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { decrypt } from "@/lib/crypto";

// Strip trailing /api/v1 if present — the route builds the full path itself
const CANVAS_BASE = (process.env.CANVAS_BASE_URL ?? "https://frostburg.instructure.com").replace(/\/api\/v1\/?$/, "");

async function getUserCanvasToken(userId: string): Promise<string | null> {
  const rows = await profQuery<{ canvas_token: string }>(
    `SELECT up.canvas_token FROM user_profile up WHERE up.user_id = $1`, [userId]
  );
  const enc = rows[0]?.canvas_token;
  if (!enc) return null;
  return decrypt(enc);
}

// GET /api/professor/grade-staging?request_id=xxx
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const requestId = req.nextUrl.searchParams.get("request_id");
  if (!requestId) return NextResponse.json({ error: "Missing request_id" }, { status: 400 });

  // Verify ownership and fetch quiz_id
  const reqRows = await profQuery<{ id: string; quiz_id: number | null }>(
    `SELECT pr.id, pa.quiz_id
     FROM prof_requests pr
     JOIN prof_assignments pa ON pa.id = pr.assignment_id
     WHERE pr.id = $1 AND pr.user_id = $2`, [requestId, uid]
  );
  if (!reqRows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const quizId = reqRows[0].quiz_id ?? null;

  const grades = await profQuery(
    `SELECT id, submission_id, student_name, student_canvas_uid, assignment_name,
            course_name, raw_score, final_score, late_penalty, grader_comment, ai_model, status,
            is_late, days_late, question_grades, quiz_submission_id
     FROM prof_grade_staging
     WHERE request_id = $1 AND user_id = $2
     ORDER BY student_name`,
    [requestId, uid]
  );
  return NextResponse.json({ grades, quiz_id: quizId });
}

// PATCH /api/professor/grade-staging — edit a single staging grade
export async function PATCH(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const { staging_id, raw_score, final_score, grader_comment, is_late, days_late, question_grades, _delete } = await req.json();
  if (!staging_id) return NextResponse.json({ error: "Missing staging_id" }, { status: 400 });

  // Delete: remove staged record permanently
  if (_delete) {
    await profQuery(
      `DELETE FROM prof_grade_staging WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [staging_id, uid]
    );
    return NextResponse.json({ ok: true, deleted: true });
  }

  if (question_grades && Array.isArray(question_grades)) {
    // Quiz: recalculate total from per-question scores
    const newTotal = question_grades.reduce((sum: number, q: any) => sum + (q.score || 0), 0);
    await profQuery(
      `UPDATE prof_grade_staging
       SET raw_score = $1, final_score = $2, grader_comment = $3,
           is_late = $4, days_late = $5, question_grades = $6::jsonb, updated_at = now()
       WHERE id = $7 AND user_id = $8 AND status = 'pending'`,
      [newTotal, newTotal, grader_comment ?? "", is_late ?? false, days_late ?? 0,
       JSON.stringify(question_grades), staging_id, uid]
    );
  } else {
    // Regular assignment
    await profQuery(
      `UPDATE prof_grade_staging
       SET raw_score = $1, final_score = $2, grader_comment = $3,
           is_late = $4, days_late = $5, updated_at = now()
       WHERE id = $6 AND user_id = $7 AND status = 'pending'`,
      [raw_score, final_score, grader_comment ?? "", is_late ?? false, days_late ?? 0, staging_id, uid]
    );
  }
  return NextResponse.json({ ok: true });
}

// POST /api/professor/grade-staging — approve (post to Canvas + prof_grades) or reject
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const { request_id, action, excluded_ids } = await req.json();
  if (!request_id || !action) {
    return NextResponse.json({ error: "Missing request_id or action" }, { status: 400 });
  }
  const excludedSet = new Set<string>((excluded_ids ?? []).map(String));

  // Verify ownership
  const reqRows = await profQuery<{
    id: string; assignment_id: number; course_canvas_id: number; assignment_name: string;
  }>(
    `SELECT id, assignment_id, course_canvas_id FROM prof_requests WHERE id = $1 AND user_id = $2`,
    [request_id, uid]
  );
  if (!reqRows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const profReq = reqRows[0];

  if (action === "approve") {
    // Get Canvas token
    const token = await getUserCanvasToken(uid);
    if (!token) return NextResponse.json({ error: "No Canvas token" }, { status: 400 });

    // Get all pending staging grades (including quiz fields)
    const stagingGrades = await profQuery<{
      id: number; submission_id: number | null; student_canvas_uid: number | null;
      final_score: string; raw_score: string; late_penalty: string; grader_comment: string;
      is_late: boolean; days_late: number;
      question_grades: any[] | null; quiz_submission_id: number | null; quiz_attempt: number | null;
    }>(
      `SELECT id, submission_id, student_canvas_uid, final_score, raw_score, late_penalty, grader_comment,
              is_late, days_late, question_grades, quiz_submission_id, quiz_attempt
       FROM prof_grade_staging
       WHERE request_id = $1 AND user_id = $2 AND status = 'pending'`,
      [request_id, uid]
    );

    // Get assignment canvas_id
    const asgRows = await profQuery<{ canvas_id: number }>(
      `SELECT canvas_id FROM prof_assignments WHERE id = $1`, [profReq.assignment_id]
    );
    const assignmentCanvasId = asgRows[0]?.canvas_id;
    if (!assignmentCanvasId) return NextResponse.json({ error: "Assignment canvas_id not found" }, { status: 400 });

    const errors: string[] = [];
    let skipped = 0;
    for (const sg of stagingGrades) {
      if (!sg.student_canvas_uid) continue;
      if (excludedSet.has(String(sg.id))) { skipped++; continue; }
      try {
        const isQuiz = sg.question_grades && sg.quiz_submission_id;

        if (isQuiz) {
          // ── Quiz: POST per-question scores via Canvas Quiz API ──
          // Get quiz_id from assignment
          const quizRows = await profQuery<{ quiz_id: number }>(
            `SELECT quiz_id FROM prof_assignments WHERE id = $1`, [profReq.assignment_id]
          );
          const quizId = quizRows[0]?.quiz_id;
          if (!quizId) {
            errors.push(`Student ${sg.student_canvas_uid}: quiz_id not found`);
            continue;
          }

          const questionUpdates: Record<string, { score: number; comment: string }> = {};
          for (const q of sg.question_grades!) {
            questionUpdates[String(q.question_id)] = {
              score: q.score,
              comment: q.comment || ""
            };
          }

          const quizRes = await fetch(
            `${CANVAS_BASE}/api/v1/courses/${profReq.course_canvas_id}/quizzes/${quizId}/submissions/${sg.quiz_submission_id}`,
            {
              method: "PUT",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                quiz_submissions: [{
                  attempt: sg.quiz_attempt ?? 1,
                  questions: questionUpdates
                }]
              }),
            }
          );
          if (!quizRes.ok) {
            const errText = await quizRes.text();
            errors.push(`Student ${sg.student_canvas_uid}: Quiz API HTTP ${quizRes.status} — ${errText.slice(0, 200)}`);
            continue;
          }
        } else {
          // ── Regular assignment: post score to Canvas ──
          const submissionPayload: Record<string, unknown> = {
            posted_grade: sg.raw_score,
          };
          if (sg.is_late) {
            submissionPayload.late_policy_status = "late";
            submissionPayload.seconds_late_override = (sg.days_late ?? 1) * 86400;
          } else if (!sg.is_late && sg.days_late === 0) {
            submissionPayload.late_policy_status = "none";
          }

          const res = await fetch(
            `${CANVAS_BASE}/api/v1/courses/${profReq.course_canvas_id}/assignments/${assignmentCanvasId}/submissions/${sg.student_canvas_uid}`,
            {
              method: "PUT",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                submission: submissionPayload,
                ...(sg.grader_comment ? { comment: { text_comment: sg.grader_comment } } : {}),
              }),
            }
          );
          if (!res.ok) {
            errors.push(`Student ${sg.student_canvas_uid}: HTTP ${res.status}`);
            continue;
          }
        }

        // Save to prof_grades
        if (sg.submission_id) {
          await profQuery(
            `INSERT INTO prof_grades (submission_id, raw_score, final_score, late_penalty, grader_comment, graded_by, canvas_posted, canvas_posted_at, user_id)
             VALUES ($1, $2, $3, $4, $5, 'ai', true, now(), $6)
             ON CONFLICT (submission_id) DO UPDATE
               SET raw_score = EXCLUDED.raw_score, final_score = EXCLUDED.final_score,
                   late_penalty = EXCLUDED.late_penalty, grader_comment = EXCLUDED.grader_comment,
                   graded_by = 'ai', canvas_posted = true, canvas_posted_at = now(), graded_at = now()`,
            [sg.submission_id, sg.raw_score, sg.final_score, sg.late_penalty ?? 0, sg.grader_comment ?? "", uid]
          );
          // Update submission state
          await profQuery(
            `UPDATE prof_submissions SET workflow_state = 'graded' WHERE id = $1`, [sg.submission_id]
          );
        }

        // Mark staging as approved
        await profQuery(
          `UPDATE prof_grade_staging SET status = 'approved', updated_at = now() WHERE id = $1`, [sg.id]
        );
      } catch (err: any) {
        errors.push(`Student ${sg.student_canvas_uid}: ${err.message}`);
      }
    }

    // Note: prof_requests status is NOT changed here — it was set to 'completed'
    // by grade_queue.py when staging was written. Approve/reject only affect staging rows.
    // Excluded students remain as 'pending' in staging for future approval.
    return NextResponse.json({ ok: true, posted: stagingGrades.length - errors.length - skipped, skipped, errors });

  } else if (action === "reject") {
    await profQuery(
      `UPDATE prof_grade_staging SET status = 'rejected', updated_at = now()
       WHERE request_id = $1 AND user_id = $2 AND status = 'pending'`,
      [request_id, uid]
    );
    // Note: prof_requests status is NOT changed — approve/reject only affect staging rows.
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
