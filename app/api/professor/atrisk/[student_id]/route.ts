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
       WHERE ps.student_canvas_uid = $1 AND pa.term_id = $2 AND pa.published = true`,
      [student.canvas_uid, termId]
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
         pg.is_late THEN COALESCE(pg.days_late, 0) ELSE NULL END AS days_late,
         ps.submitted_at
       FROM prof_assignments pa
       LEFT JOIN prof_submissions ps ON pa.id = ps.assignment_id AND ps.student_canvas_uid = $1
       LEFT JOIN prof_grades pg ON ps.id = pg.submission_id
       WHERE pa.term_id = $2 AND pa.published = true
       ORDER BY pa.created_at`,
      [student.canvas_uid, termId]
    );

    // Calculate at-risk reasons
    const reasons: string[] = [];
    const missingCount = assignmentsRows.filter(a => !a.submitted).length;
    const attendance = 0; // TODO: implement attendance fetch

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

    // TODO: Add attendance reasons once attendance is fetched

    // Get attendance data
    const attendanceRows = await profQuery<{
      total_sessions: string;
      attended: string;
      percentage: string;
    }>(
      `SELECT
         COUNT(*)::text AS total_sessions,
         SUM(CASE WHEN attended = true THEN 1 ELSE 0 END)::text AS attended,
         ROUND(100.0 * SUM(CASE WHEN attended = true THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0))::text AS percentage
       FROM prof_attendance
       WHERE student_canvas_uid = $1 AND term_id = $2`,
      [student.canvas_uid, termId]
    );

    const attendanceData = attendanceRows.length > 0 ? attendanceRows[0] : { total_sessions: "0", attended: "0", percentage: "0" };
    const attendancePercent = parseInt(attendanceData.percentage || "0");

    if (attendancePercent < 50) {
      reasons.push(`Attendance: ${attendancePercent}% (critical)`);
    } else if (attendancePercent < 75) {
      reasons.push(`Attendance: ${attendancePercent}% (low)`);
    }

    // Get recent absences
    const absencesRows = await profQuery<{
      date: string;
      session: string;
    }>(
      `SELECT date::text, session FROM prof_attendance
       WHERE student_canvas_uid = $1 AND term_id = $2 AND attended = false
       ORDER BY date DESC
       LIMIT 5`,
      [student.canvas_uid, termId]
    );

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
        total_sessions: parseInt(attendanceData.total_sessions),
        attended: parseInt(attendanceData.attended),
        percentage: attendancePercent,
        recent_absences: absencesRows.map(a => ({
          date: a.date,
          session: a.session,
        })),
      },
    });
  } catch (err) {
    console.error("[atrisk-detail]", err);
    return NextResponse.json({ error: "Failed to fetch student details" }, { status: 500 });
  }
}
