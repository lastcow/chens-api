import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });
  const courseId = req.nextUrl.searchParams.get("course_id");

  const students = await profQuery(`
    SELECT
      s.id, s.canvas_uid, s.sortable_name AS name, s.email,
      c.name AS course_name, c.canvas_id AS course_canvas_id,
      COALESCE(att.attendance_score, 0) AS attendance,
      COUNT(sub.id) FILTER (WHERE sub.workflow_state = 'unsubmitted' OR sub.submitted_at IS NULL) AS missing_count,
      COUNT(sub.id) FILTER (WHERE sub.workflow_state IN ('submitted','pending_review') AND g.id IS NULL) AS ungraded_count,
      ROUND(AVG(g.final_score)::numeric, 1) AS avg_grade,
      COUNT(DISTINCT a.id) FILTER (WHERE a.due_at IS NOT NULL AND a.due_at < now()) AS total_due
    FROM prof_students s
    JOIN prof_enrollments e ON e.student_id = s.id AND e.user_id = $1
    JOIN prof_courses c ON c.id = e.course_id AND c.user_id = $1
    LEFT JOIN prof_attendance att ON att.student_id = s.id AND att.course_id = c.id AND att.user_id = $1
    LEFT JOIN prof_assignments a ON a.course_id = c.id AND a.user_id = $1
      AND a.assignment_type != 'quiz'
      AND a.name NOT ILIKE '%progress report%'
      AND a.name NOT ILIKE '%attendance%'
    LEFT JOIN prof_submissions sub ON sub.student_id = s.id AND sub.assignment_id = a.id
    LEFT JOIN prof_grades g ON g.submission_id = sub.id
    ${courseId ? "WHERE c.canvas_id = $2" : ""}
    GROUP BY s.id, c.id, c.name, c.canvas_id, att.attendance_score
    ORDER BY c.name, s.sortable_name
  `, courseId ? [uid, parseInt(courseId)] : [uid]);

  return NextResponse.json({ students });
}
