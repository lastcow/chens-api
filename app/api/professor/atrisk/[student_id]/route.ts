import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ student_id: string }> }
) {
  const { student_id } = await params;
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const canvasUid = parseInt(student_id);
  if (isNaN(canvasUid)) return NextResponse.json({ error: "Invalid student_id" }, { status: 400 });

  const termParam = req.nextUrl.searchParams.get("term_id");
  const termId = termParam ? parseInt(termParam) : 245; // Default to current term

  try {
    // Fetch student basic info
    const studentRows = await profQuery<{
      id: number;
      name: string;
      canvas_uid: number;
      email: string | null;
    }>(
      `SELECT s.id, s.name, s.canvas_uid, u.email
       FROM prof_students s
       LEFT JOIN public."User" u ON s.email = u.email
       WHERE s.canvas_uid = $1`,
      [canvasUid]
    );

    if (!studentRows.length) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const student = studentRows[0];

    // Get current grade (average of final scores in this term's courses for this user)
    const gradeRows = await profQuery<{ avg_score: string | null }>(
      `SELECT ROUND(AVG(pg.final_score)::numeric, 2)::text AS avg_score
       FROM prof_grades pg
       JOIN prof_submissions ps ON pg.submission_id = ps.id
       JOIN prof_assignments pa ON ps.assignment_id = pa.id
       WHERE ps.student_id = $1 AND pa.term_id = $2 AND pa.published = true`,
      [student.id, termId]
    );

    const currentGrade = gradeRows.length > 0 && gradeRows[0].avg_score ? parseFloat(gradeRows[0].avg_score) : 0;

    // Get all assignments with submission status for this student
    const assignmentsRows = await profQuery<{
      id: number;
      name: string;
      submitted: boolean;
      grade: string | null;
      points_possible: string;
      status: string;
      days_late: number | null;
      submitted_at: string | null;
    }>(
      `SELECT
         pa.id,
         pa.name,
         CASE WHEN ps.id IS NOT NULL THEN true ELSE false END AS submitted,
         pg.final_score::text AS grade,
         pa.points_possible::text,
         CASE
           WHEN ps.id IS NULL THEN 'missing'
           WHEN pg.id IS NOT NULL THEN 'graded'
           ELSE 'ungraded'
         END AS status,
         CASE WHEN pg.late_penalty > 0 THEN COALESCE(pg.late_penalty::int, 0) ELSE NULL END AS days_late,
         ps.submitted_at
       FROM prof_assignments pa
       LEFT JOIN prof_submissions ps ON pa.id = ps.assignment_id AND ps.student_id = $1
       LEFT JOIN prof_grades pg ON ps.id = pg.submission_id
       WHERE pa.term_id = $2 AND pa.published = true
       ORDER BY pa.created_at`,
      [student.id, termId]
    );

    // Calculate at-risk reasons
    const reasons: string[] = [];
    const missingCount = assignmentsRows.filter(a => !a.submitted).length;

    if (currentGrade < 60) {
      reasons.push(`Grade: ${currentGrade}% (critical)`);
    } else if (currentGrade < 70) {
      reasons.push(`Grade: ${currentGrade}% (below 70% threshold)`);
    }

    if (missingCount >= 5) {
      reasons.push(`${missingCount} missing assignments (critical)`);
    } else if (missingCount >= 3) {
      reasons.push(`${missingCount} missing assignments`);
    }

    // Get attendance data (from attendance_score stored per student per course)
    const attendanceRows = await profQuery<{
      attendance_score: string | null;
    }>(
      `SELECT COALESCE(pa.attendance_score, 0)::text AS attendance_score
       FROM prof_attendance pa
       JOIN prof_courses pc ON pa.course_id = pc.id
       WHERE pa.student_id = $1 AND pc.term_id = $2
       LIMIT 1`,
      [student.id, termId]
    );

    const attendanceScore = attendanceRows.length > 0 && attendanceRows[0].attendance_score 
      ? parseInt(attendanceRows[0].attendance_score) 
      : 0;

    if (attendanceScore < 50) {
      reasons.push(`Attendance: ${attendanceScore}% (critical)`);
    } else if (attendanceScore < 75) {
      reasons.push(`Attendance: ${attendanceScore}% (low)`);
    }

    // Get recent absences (prof_attendance doesn't have date info, so return empty list)
    const absencesRows: Array<{ date: string; session: string }> = [];

    return NextResponse.json({
      student: {
        id: student.id,
        name: student.name,
        canvas_uid: student.canvas_uid,
        email: student.email || "",
      },
      at_risk: {
        status: reasons.length > 0,
        reasons,
      },
      grade: {
        current: Math.round(currentGrade),
        out_of: 100,
        percentage: currentGrade,
      },
      assignments: assignmentsRows.map(a => ({
        id: a.id,
        name: a.name,
        submitted: a.submitted,
        grade: a.grade ? parseInt(a.grade) : null,
        points_possible: parseInt(a.points_possible),
        status: a.status,
        days_late: a.days_late,
        submitted_at: a.submitted_at,
      })),
      attendance: {
        total_sessions: 0, // Not tracked at this level
        attended: 0,
        percentage: attendanceScore,
        recent_absences: absencesRows,
      },
    });
  } catch (err) {
    console.error("[atrisk-detail]", err);
    return NextResponse.json({ error: "Failed to fetch student details" }, { status: 500 });
  }
}
