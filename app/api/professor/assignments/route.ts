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
  const extraWhere = conditions.length ? `AND ${conditions.join(" AND ")}` : "";

  const assignments = await profQuery(`
    SELECT
      a.id, a.canvas_id, a.name, a.points_possible, a.due_at, a.assignment_type,
      c.name AS course_name, c.canvas_id AS course_canvas_id,
      COUNT(sub.id) FILTER (WHERE sub.workflow_state = 'graded' OR g.id IS NOT NULL) AS graded_count,
      COUNT(sub.id) FILTER (
        WHERE sub.workflow_state IN ('submitted','pending_review')
          AND g.id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM prof_grade_staging pgs2
            JOIN prof_requests pr2 ON pr2.id = pgs2.request_id
            WHERE pr2.assignment_id = a.id AND pr2.user_id = $1
              AND pgs2.submission_id = sub.id AND pgs2.status = 'pending'
          )
      ) AS ungraded_count,
      COUNT(sub.id) FILTER (WHERE sub.workflow_state = 'unsubmitted' OR sub.submitted_at IS NULL) AS missing_count,
      ROUND(AVG(g.final_score)::numeric, 1) AS avg_score,
      COUNT(DISTINCT e.student_id) AS total_students,
      COALESCE((
        SELECT COUNT(pgs.id)
        FROM prof_requests pr
        JOIN prof_grade_staging pgs ON pgs.request_id = pr.id AND pgs.status = 'pending'
        WHERE pr.assignment_id = a.id AND pr.user_id = $1
          AND pr.status IN ('pending','in_progress')
      ), 0) AS staging_count,
      (
        SELECT pr.id FROM prof_requests pr
        WHERE pr.assignment_id = a.id AND pr.user_id = $1
          AND pr.status IN ('pending','in_progress')
        ORDER BY pr.created_at DESC LIMIT 1
      ) AS pending_request_id
    FROM prof_assignments a
    JOIN prof_courses c ON c.id = a.course_id AND c.user_id = $1
    JOIN prof_enrollments e ON e.course_id = c.id AND e.user_id = $1
    LEFT JOIN prof_submissions sub ON sub.assignment_id = a.id AND sub.student_id = e.student_id
    LEFT JOIN prof_grades g ON g.submission_id = sub.id
    WHERE a.user_id = $1
      AND a.published = true
      AND a.name NOT ILIKE '%progress report%'
      AND a.name NOT ILIKE '%attendance%'
      AND a.name NOT ILIKE '%roll call%'
      ${extraWhere}
    GROUP BY a.id, c.id ORDER BY c.name, a.due_at NULLS LAST
  `, params);

  return NextResponse.json({ assignments });
}
