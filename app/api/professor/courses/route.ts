import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const courses = await profQuery(`
    SELECT
      c.id, c.canvas_id, c.name, c.course_code, c.term_name,
      COUNT(DISTINCT e.student_id) AS student_count,
      COUNT(DISTINCT a.id) FILTER (WHERE a.assignment_type = 'assignment' AND a.due_at IS NOT NULL) AS assignment_count,
      ROUND(AVG(g.final_score)::numeric, 1) AS avg_grade,
      COUNT(DISTINCT sub.id) FILTER (WHERE sub.workflow_state IN ('submitted','pending_review') AND g.id IS NULL) AS ungraded_count
    FROM prof_courses c
    LEFT JOIN prof_enrollments e ON e.course_id = c.id AND e.user_id = $1
    LEFT JOIN prof_assignments a ON a.course_id = c.id AND a.user_id = $1
    LEFT JOIN prof_submissions sub ON sub.assignment_id = a.id
    LEFT JOIN prof_grades g ON g.submission_id = sub.id
    WHERE c.user_id = $1
    GROUP BY c.id ORDER BY c.name
  `, [uid]);

  return NextResponse.json({ courses });
}
