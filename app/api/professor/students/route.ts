import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });
  const courseId = req.nextUrl.searchParams.get("course_id");
  const termId   = req.nextUrl.searchParams.get("term_id");

  const conditions: string[] = [];
  const params: unknown[] = [uid];

  if (courseId) { params.push(parseInt(courseId)); conditions.push(`c.canvas_id = $${params.length}`); }
  if (termId)   { params.push(parseInt(termId));   conditions.push(`c.term_id = $${params.length}`); }
  const where = conditions.length ? `AND ${conditions.join(" AND ")}` : "";

  // Separate param set for the course_count subquery JOIN
  const ccParams: unknown[] = [uid];
  if (termId) ccParams.push(parseInt(termId));
  const ccTermFilter = termId ? `AND c2.term_id = $${ccParams.length}` : "";

  const students = await profQuery(`
    SELECT
      s.id, s.canvas_uid, s.sortable_name AS name, s.email,
      c.name AS course_name, c.canvas_id AS course_canvas_id,
      e.enrollment_state,
      COALESCE(att.attendance_score, 0) AS attendance,
      COUNT(sub.id) FILTER (WHERE sub.workflow_state = 'unsubmitted' OR sub.submitted_at IS NULL) AS missing_count,
      COUNT(sub.id) FILTER (WHERE sub.workflow_state IN ('submitted','pending_review') AND g.id IS NULL) AS ungraded_count,
      ROUND(AVG(g.final_score)::numeric, 1) AS avg_grade,
      COUNT(DISTINCT a.id) FILTER (WHERE a.due_at IS NOT NULL AND a.due_at < now()) AS total_due,
      cc.course_count
    FROM prof_students s
    JOIN prof_enrollments e ON e.student_id = s.id AND e.user_id = $1
    JOIN prof_courses c ON c.id = e.course_id AND c.user_id = $1
    JOIN (
      SELECT e2.student_id, COUNT(DISTINCT e2.course_id) AS course_count
      FROM prof_enrollments e2
      JOIN prof_courses c2 ON c2.id = e2.course_id AND c2.user_id = $1 ${ccTermFilter}
      WHERE e2.user_id = $1
      GROUP BY e2.student_id
    ) cc ON cc.student_id = s.id
    LEFT JOIN prof_attendance att ON att.student_id = s.id AND att.course_id = c.id AND att.user_id = $1
    LEFT JOIN prof_assignments a ON a.course_id = c.id AND a.user_id = $1
      AND a.assignment_type != 'quiz'
      AND a.published = true
      AND a.due_at IS NOT NULL AND a.due_at < now()
      AND a.name NOT ILIKE '%progress report%'
      AND a.name NOT ILIKE '%attendance%'
    LEFT JOIN prof_submissions sub ON sub.student_id = s.id AND sub.assignment_id = a.id
    LEFT JOIN prof_grades g ON g.submission_id = sub.id
    WHERE e.user_id = $1 ${where}
    GROUP BY s.id, c.id, c.name, c.canvas_id, e.enrollment_state, att.attendance_score, cc.course_count
    ORDER BY c.name, s.sortable_name
  `, params);

  return NextResponse.json({ students });
}
