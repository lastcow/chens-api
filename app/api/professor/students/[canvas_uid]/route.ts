import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { decrypt } from "@/lib/crypto";

const CANVAS_BASE = (process.env.CANVAS_BASE_URL ?? "https://frostburg.instructure.com").replace(/\/api\/v1\/?$/, "");

async function getUserCanvasToken(userId: string): Promise<{ token: string; canvasUserId: number | null } | null> {
  const rows = await profQuery<{ canvas_token: string; canvas_user_id: number | null }>(
    `SELECT up.canvas_token, up.canvas_user_id FROM user_profile up WHERE up.user_id = $1`, [userId]
  );
  const enc = rows[0]?.canvas_token;
  if (!enc) return null;
  const token = decrypt(enc);
  return { token, canvasUserId: rows[0]?.canvas_user_id ?? null };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ canvas_uid: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });
  const { canvas_uid } = await params;
  const canvasUid = parseInt(canvas_uid);
  if (isNaN(canvasUid)) return NextResponse.json({ error: "Invalid canvas_uid" }, { status: 400 });

  // Get student info
  const studentRows = await profQuery<{ id: number; name: string; email: string; canvas_uid: number }>(
    `SELECT id, sortable_name AS name, email, canvas_uid FROM prof_students WHERE canvas_uid = $1 LIMIT 1`,
    [canvasUid]
  );
  if (!studentRows.length) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  const student = studentRows[0];

  // Get all courses this student is enrolled in (that this professor teaches)
  const courseRows = await profQuery<{
    course_id: number; course_name: string; course_canvas_id: number;
    enrollment_state: string; attendance_score: number | null;
  }>(
    `SELECT c.id AS course_id, c.name AS course_name, c.canvas_id AS course_canvas_id,
            e.enrollment_state,
            att.attendance_score
     FROM prof_enrollments e
     JOIN prof_courses c ON c.id = e.course_id AND c.user_id = $1
     LEFT JOIN prof_attendance att ON att.student_id = $2 AND att.course_id = c.id AND att.user_id = $1
     WHERE e.user_id = $1 AND e.student_id = $2
     ORDER BY c.name`,
    [uid, student.id]
  );

  // Get all assignments + submissions + grades for this student across professor's courses
  const assignmentRows = await profQuery<{
    course_id: number; assignment_id: number; assignment_canvas_id: number;
    assignment_name: string; points_possible: number;
    due_at: string | null; is_quiz: boolean; quiz_id: number | null; assignment_type: string;
    submission_id: number | null; score: number | null; final_score: number | null;
    late_penalty: number | null; grader_comment: string | null; canvas_comment_id: number | null;
    workflow_state: string | null; late: boolean | null; submitted_at: string | null;
    course_canvas_id: number; canvas_posted: boolean | null;
  }>(
    `SELECT a.course_id, a.id AS assignment_id, a.canvas_id AS assignment_canvas_id,
            a.name AS assignment_name, a.points_possible,
            a.due_at, a.is_quiz, a.quiz_id, a.assignment_type,
            sub.id AS submission_id,
            g.raw_score AS score, g.final_score, g.late_penalty, g.grader_comment, g.canvas_comment_id,
            sub.workflow_state, sub.late, sub.submitted_at,
            c.canvas_id AS course_canvas_id,
            g.canvas_posted
     FROM prof_assignments a
     JOIN prof_courses c ON c.id = a.course_id AND c.user_id = $1
     JOIN prof_enrollments e ON e.course_id = c.id AND e.student_id = $2 AND e.user_id = $1
     LEFT JOIN prof_submissions sub ON sub.assignment_id = a.id AND sub.student_id = $2
     LEFT JOIN prof_grades g ON g.submission_id = sub.id
     WHERE a.user_id = $1 AND a.published = true
     ORDER BY a.due_at NULLS LAST, a.name`,
    [uid, student.id]
  );

  // Get quiz question grades from staging for this student
  const quizGrades = await profQuery<{
    assignment_name: string; question_grades: any; quiz_submission_id: number | null;
    days_late: number | null; is_late: boolean;
  }>(
    `SELECT pgs.assignment_name, pgs.question_grades, pgs.quiz_submission_id,
            pgs.days_late, pgs.is_late
     FROM prof_grade_staging pgs
     WHERE pgs.student_canvas_uid = $1 AND pgs.user_id = $2
       AND pgs.question_grades IS NOT NULL
       AND pgs.status IN ('approved', 'pending')
     ORDER BY pgs.created_at DESC`,
    [canvasUid, uid]
  );

  // Index quiz question grades by assignment name
  const quizMap = new Map<string, { question_grades: any; quiz_submission_id: number | null; days_late: number | null; is_late: boolean }>();
  for (const qg of quizGrades) {
    if (!quizMap.has(qg.assignment_name)) {
      quizMap.set(qg.assignment_name, qg);
    }
  }

  // Fetch missing comments from Canvas API (by professor), backfill comment + canvas_comment_id
  const emptyCommentRows = assignmentRows.filter(
    a => a.submission_id && a.score !== null && (!a.grader_comment || a.grader_comment === "")
  );
  if (emptyCommentRows.length > 0) {
    const tokenData = await getUserCanvasToken(uid);
    if (tokenData) {
      let { token, canvasUserId } = tokenData;
      // Resolve canvas_user_id if not cached
      if (!canvasUserId) {
        try {
          const meRes = await fetch(`${CANVAS_BASE}/api/v1/users/self`, { headers: { Authorization: `Bearer ${token}` } });
          if (meRes.ok) {
            const me = await meRes.json();
            canvasUserId = me.id;
            await profQuery(`UPDATE user_profile SET canvas_user_id = $1 WHERE user_id = $2`, [canvasUserId, uid]);
          }
        } catch { /* ignore */ }
      }
      const fetchPromises = emptyCommentRows.map(async (a) => {
        try {
          const url = `${CANVAS_BASE}/api/v1/courses/${a.course_canvas_id}/assignments/${a.assignment_canvas_id}/submissions/${canvasUid}?include[]=submission_comments`;
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) return;
          const data = await res.json();
          const allComments: Array<{ id: number; author_id: number; comment: string }> = data.submission_comments ?? [];
          // Filter to professor's comments only, take latest
          const profComments = canvasUserId
            ? allComments.filter(c => c.author_id === canvasUserId)
            : allComments;
          if (profComments.length > 0) {
            const latest = profComments[profComments.length - 1];
            a.grader_comment = latest.comment;
            a.canvas_comment_id = latest.id;
            await profQuery(
              `UPDATE prof_grades SET grader_comment = $1, canvas_comment_id = $2 
               WHERE submission_id = $3 AND (grader_comment IS NULL OR grader_comment = '')`,
              [latest.comment, latest.id, a.submission_id]
            );
          }
        } catch { /* ignore */ }
      });
      await Promise.all(fetchPromises);
    }
  }

  // Group assignments by course
  const courses = courseRows.map(c => ({
    course_name: c.course_name,
    course_canvas_id: c.course_canvas_id,
    enrollment_state: c.enrollment_state,
    attendance_score: c.attendance_score ?? 0,
    assignments: assignmentRows
      .filter(a => a.course_id === c.course_id)
      .map(a => {
        const quiz = a.is_quiz ? quizMap.get(a.assignment_name) : null;
        return {
          assignment_id: a.assignment_id,
          submission_id: a.submission_id,
          name: a.assignment_name,
          points_possible: a.points_possible,
          due_at: a.due_at,
          is_quiz: a.is_quiz,
          quiz_id: a.quiz_id,
          assignment_type: a.assignment_type,
          score: a.score,
          final_score: a.final_score,
          late_penalty: a.late_penalty,
          grader_comment: a.grader_comment,
          canvas_comment_id: a.canvas_comment_id ?? null,
          workflow_state: a.workflow_state,
          late: a.late,
          submitted_at: a.submitted_at,
          course_canvas_id: a.course_canvas_id,
          canvas_posted: a.canvas_posted ?? null,
          question_grades: quiz?.question_grades ?? null,
          quiz_submission_id: quiz?.quiz_submission_id ?? null,
        };
      }),
  }));

  return NextResponse.json({
    student: { name: student.name, email: student.email, canvas_uid: student.canvas_uid },
    courses,
  });
}

// PUT /api/professor/students/[canvas_uid] — update grade for a single assignment
export async function PUT(req: NextRequest, { params }: { params: Promise<{ canvas_uid: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });
  const { canvas_uid } = await params;
  const canvasUid = parseInt(canvas_uid);
  if (isNaN(canvasUid)) return NextResponse.json({ error: "Invalid canvas_uid" }, { status: 400 });

  const body = await req.json();
  const { submission_id, assignment_id, score, comment, is_late, days_late, late_penalty,
          question_grades, quiz_submission_id, course_canvas_id, quiz_id, post_to_canvas,
          canvas_comment_id } = body;

  if (!submission_id || !assignment_id) {
    return NextResponse.json({ error: "Missing submission_id or assignment_id" }, { status: 400 });
  }

  const finalScore = Math.max(0, (score ?? 0) - (late_penalty ?? 0));

  // Update prof_grades — mark as unpushed when not posting to Canvas
  const posted = post_to_canvas ? true : false;
  await profQuery(
    `INSERT INTO prof_grades (submission_id, raw_score, final_score, late_penalty, grader_comment, canvas_comment_id, graded_by, graded_at, canvas_posted, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'manual', now(), $7, $8)
     ON CONFLICT (submission_id) DO UPDATE
       SET raw_score = EXCLUDED.raw_score, final_score = EXCLUDED.final_score,
           late_penalty = EXCLUDED.late_penalty, grader_comment = EXCLUDED.grader_comment,
           graded_by = 'manual', graded_at = now(), canvas_posted = $7`,
    [submission_id, score, finalScore, late_penalty ?? 0, comment ?? "", canvas_comment_id ?? null, posted, uid]
  );

  // Update submission workflow state
  await profQuery(
    `UPDATE prof_submissions SET workflow_state = 'graded', late = $1 WHERE id = $2`,
    [is_late ?? false, submission_id]
  );

  // Update staging if it exists (keep in sync)
  if (question_grades && Array.isArray(question_grades)) {
    await profQuery(
      `UPDATE prof_grade_staging
       SET raw_score = $1, final_score = $2, grader_comment = $3,
           is_late = $4, days_late = $5, late_penalty = $6,
           question_grades = $7::jsonb, updated_at = now()
       WHERE student_canvas_uid = $8 AND user_id = $9 AND assignment_name = (
         SELECT name FROM prof_assignments WHERE id = $10
       ) AND status IN ('approved', 'pending')`,
      [score, finalScore, comment ?? "", is_late ?? false, days_late ?? 0, late_penalty ?? 0,
       JSON.stringify(question_grades), canvasUid, uid, assignment_id]
    );
  }

  // Optionally post to Canvas
  if (post_to_canvas && course_canvas_id) {
    const tokenData = await getUserCanvasToken(uid);
    if (!tokenData) return NextResponse.json({ error: "No Canvas token" }, { status: 400 });
    const token = tokenData.token;

    const asgRows = await profQuery<{ canvas_id: number }>(
      `SELECT canvas_id FROM prof_assignments WHERE id = $1`, [assignment_id]
    );
    const assignmentCanvasId = asgRows[0]?.canvas_id;
    if (!assignmentCanvasId) return NextResponse.json({ error: "Assignment canvas_id not found" }, { status: 400 });

    const isQuiz = question_grades && quiz_submission_id && quiz_id;

    if (isQuiz) {
      // Quiz: update per-question scores
      const questionUpdates: Record<string, { score: number; comment: string }> = {};
      for (const q of question_grades) {
        questionUpdates[String(q.question_id)] = { score: q.score, comment: q.comment || "" };
      }
      const quizRes = await fetch(
        `${CANVAS_BASE}/api/v1/courses/${course_canvas_id}/quizzes/${quiz_id}/submissions/${quiz_submission_id}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            quiz_submissions: [{ attempt: 1, questions: questionUpdates }]
          }),
        }
      );
      if (!quizRes.ok) {
        const errText = await quizRes.text();
        return NextResponse.json({ ok: true, canvas_error: `Quiz API HTTP ${quizRes.status}: ${errText.slice(0, 200)}` });
      }
    } else {
      // Regular assignment — update score
      const submissionPayload: Record<string, unknown> = { posted_grade: score };
      if (is_late) {
        submissionPayload.late_policy_status = "late";
        submissionPayload.seconds_late_override = (days_late ?? 1) * 86400;
      }
      const res = await fetch(
        `${CANVAS_BASE}/api/v1/courses/${course_canvas_id}/assignments/${assignmentCanvasId}/submissions/${canvasUid}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ submission: submissionPayload }),
        }
      );
      if (!res.ok) {
        return NextResponse.json({ ok: true, canvas_error: `HTTP ${res.status}` });
      }

      // Handle comment: edit existing or create new
      if (comment) {
        let newCommentId: number | null = null;
        if (canvas_comment_id) {
          // Edit existing comment
          const editRes = await fetch(
            `${CANVAS_BASE}/api/v1/courses/${course_canvas_id}/assignments/${assignmentCanvasId}/submissions/${canvasUid}/comments/${canvas_comment_id}`,
            {
              method: "PUT",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ comment: comment }),
            }
          );
          if (editRes.ok) {
            const editData = await editRes.json();
            newCommentId = editData.submission_comment?.id ?? canvas_comment_id;
          }
        } else {
          // Create new comment
          const commentRes = await fetch(
            `${CANVAS_BASE}/api/v1/courses/${course_canvas_id}/assignments/${assignmentCanvasId}/submissions/${canvasUid}`,
            {
              method: "PUT",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ comment: { text_comment: comment } }),
            }
          );
          if (commentRes.ok) {
            const commentData = await commentRes.json();
            const comments = commentData.submission_comments ?? [];
            newCommentId = comments.length > 0 ? comments[comments.length - 1].id : null;
          }
        }
        // Save comment ID to DB
        if (newCommentId) {
          await profQuery(
            `UPDATE prof_grades SET canvas_comment_id = $1, grader_comment = $2 WHERE submission_id = $3`,
            [newCommentId, comment, submission_id]
          );
        }
      }
    }

    // Mark as posted
    await profQuery(
      `UPDATE prof_grades SET canvas_posted = true, canvas_posted_at = now() WHERE submission_id = $1`,
      [submission_id]
    );
  }

  return NextResponse.json({ ok: true });
}
