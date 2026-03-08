import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });
  const courseId = req.nextUrl.searchParams.get("course_id");

  const assignments = await profQuery(`
    SELECT
      a.id, a.canvas_id, a.name, a.points_possible, a.due_at, a.assignment_type,
      c.name AS course_name, c.canvas_id AS course_canvas_id,
      COUNT(sub.id) FILTER (WHERE sub.workflow_state = 'graded' OR g.id IS NOT NULL) AS graded_count,
      COUNT(sub.id) FILTER (WHERE sub.workflow_state IN ('submitted','pending_review') AND g.id IS NULL) AS ungraded_count,
      COUNT(sub.id) FILTER (WHERE sub.workflow_state = 'unsubmitted' OR sub.submitted_at IS NULL) AS missing_count,
      ROUND(AVG(g.final_score)::numeric, 1) AS avg_score,
      COUNT(DISTINCT e.student_id) AS total_students
    FROM prof_assignments a
    JOIN prof_courses c ON c.id = a.course_id AND c.user_id = $1
    JOIN prof_enrollments e ON e.course_id = c.id AND e.user_id = $1
    LEFT JOIN prof_submissions sub ON sub.assignment_id = a.id AND sub.student_id = e.student_id
    LEFT JOIN prof_grades g ON g.submission_id = sub.id
    WHERE a.user_id = $1
      AND a.name NOT ILIKE '%progress report%'
      AND a.name NOT ILIKE '%attendance%'
      AND a.name NOT ILIKE '%roll call%'
      ${courseId ? "AND c.canvas_id = $2" : ""}
    GROUP BY a.id, c.id ORDER BY c.name, a.due_at NULLS LAST
  `, courseId ? [uid, parseInt(courseId)] : [uid]);

  return NextResponse.json({ assignments });
}
