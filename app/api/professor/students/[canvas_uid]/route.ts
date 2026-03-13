import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

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
    course_id: number; assignment_name: string; points_possible: number;
    due_at: string | null; is_quiz: boolean; assignment_type: string;
    score: number | null; final_score: number | null; grader_comment: string | null;
    workflow_state: string | null; late: boolean | null; submitted_at: string | null;
  }>(
    `SELECT a.course_id, a.name AS assignment_name, a.points_possible,
            a.due_at, a.is_quiz, a.assignment_type,
            g.raw_score AS score, g.final_score, g.grader_comment,
            sub.workflow_state, sub.late, sub.submitted_at
     FROM prof_assignments a
     JOIN prof_courses c ON c.id = a.course_id AND c.user_id = $1
     JOIN prof_enrollments e ON e.course_id = c.id AND e.student_id = $2 AND e.user_id = $1
     LEFT JOIN prof_submissions sub ON sub.assignment_id = a.id AND sub.student_id = $2
     LEFT JOIN prof_grades g ON g.submission_id = sub.id
     WHERE a.user_id = $1 AND a.published = true
     ORDER BY a.due_at NULLS LAST, a.name`,
    [uid, student.id]
  );

  // Group assignments by course
  const courses = courseRows.map(c => ({
    course_name: c.course_name,
    course_canvas_id: c.course_canvas_id,
    enrollment_state: c.enrollment_state,
    attendance_score: c.attendance_score ?? 0,
    assignments: assignmentRows
      .filter(a => a.course_id === c.course_id)
      .map(a => ({
        name: a.assignment_name,
        points_possible: a.points_possible,
        due_at: a.due_at,
        is_quiz: a.is_quiz,
        assignment_type: a.assignment_type,
        score: a.score,
        final_score: a.final_score,
        grader_comment: a.grader_comment,
        workflow_state: a.workflow_state,
        late: a.late,
        submitted_at: a.submitted_at,
      })),
  }));

  return NextResponse.json({
    student: { name: student.name, email: student.email, canvas_uid: student.canvas_uid },
    courses,
  });
}
