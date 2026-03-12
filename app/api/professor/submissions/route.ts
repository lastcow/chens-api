import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const assignmentId = req.nextUrl.searchParams.get("assignment_id");
  if (!assignmentId) {
    return NextResponse.json({ error: "Missing assignment_id" }, { status: 400 });
  }

  try {
    const rows = await profQuery<{
      id: number;
      student_name: string;
      student_canvas_uid: number;
      submitted_at: string | null;
      workflow_state: string;
      final_score: string | null;
      points_possible: string;
    }>(
      `SELECT
         ps.id,
         ps.student_id,
         s.name AS student_name,
         s.canvas_uid AS student_canvas_uid,
         ps.submitted_at,
         ps.workflow_state,
         pg.final_score,
         pa.points_possible
       FROM prof_submissions ps
       JOIN prof_students s ON ps.student_id = s.id
       JOIN prof_assignments pa ON ps.assignment_id = pa.id
       LEFT JOIN prof_grades pg ON ps.id = pg.submission_id
       WHERE ps.assignment_id = $1
       AND pa.course_id IN (SELECT id FROM prof_courses WHERE user_id = $2)
       ORDER BY s.name ASC`,
      [parseInt(assignmentId), uid]
    );

    const submissions = rows.map(r => ({
      id: r.id,
      student_name: r.student_name,
      student_canvas_uid: r.student_canvas_uid,
      submitted_at: r.submitted_at,
      workflow_state: r.workflow_state,
      status: !r.submitted_at || r.workflow_state === "unsubmitted"
        ? "missing"
        : r.final_score !== null
        ? "graded"
        : "ungraded",
      grade: r.final_score ? parseInt(r.final_score) : null,
      points_possible: parseInt(r.points_possible),
    }));

    return NextResponse.json({ submissions });
  } catch (err) {
    console.error("[submissions]", err);
    return NextResponse.json({ error: "Failed to fetch submissions" }, { status: 500 });
  }
}
