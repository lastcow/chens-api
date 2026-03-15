import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  try {
    const { assignment_id, canvas_id } = await req.json();
    if (!assignment_id) {
      return NextResponse.json({ error: "Missing assignment_id" }, { status: 400 });
    }

    const assignmentIdInt = parseInt(assignment_id);
    const canvasIdInt = canvas_id ? parseInt(canvas_id) : null;
    const uidInt = parseInt(uid);
    console.log(`Publish request: assignment_id=${assignmentIdInt}, canvas_id=${canvasIdInt}, uid=${uidInt}`);

    // Verify assignment exists and belongs to this user
    // First, try direct lookup with user_id
    let assignment = await profQuery(
      `SELECT a.id, a.canvas_id, a.user_id, a.published, a.course_id 
       FROM prof_assignments a
       WHERE a.id = $1 AND a.user_id = $2`,
      [assignmentIdInt, uidInt]
    );

    console.log(`Direct query result:`, assignment);

    // If not found by user_id, try by canvas_id
    if (!assignment || assignment.length === 0) {
      assignment = await profQuery(
        `SELECT a.id, a.canvas_id, a.user_id, a.published, a.course_id 
         FROM prof_assignments a
         WHERE a.canvas_id = $1 AND a.user_id = $2`,
        [canvasIdInt, uidInt]
      );
      console.log(`Canvas ID query result:`, assignment);
    }

    // Debug: see what's in the database
    if (!assignment || assignment.length === 0) {
      const anyAssignment = await profQuery(
        `SELECT a.id, a.canvas_id, a.user_id, a.published FROM prof_assignments a WHERE a.id = $1 OR a.canvas_id = $1`,
        [assignmentIdInt]
      );
      console.log(`Assignment in DB by ID or canvas_id:`, anyAssignment);
      
      const userAssignments = await profQuery(
        `SELECT a.id, a.canvas_id, a.user_id, a.published FROM prof_assignments a WHERE a.user_id = $1 LIMIT 5`,
        [uidInt]
      );
      console.log(`User's assignments:`, userAssignments);
      
      return NextResponse.json({ 
        error: "Assignment not found or you don't have permission to publish it",
        debug: { 
          assignment_id: assignmentIdInt, 
          canvas_id: canvasIdInt, 
          uid_sent: uid, 
          uid_parsed: uidInt,
          found_by_id: !!anyAssignment?.length,
          user_assignments_count: userAssignments?.length || 0
        }
      }, { status: 404 });
    }

    if (assignment[0].published) {
      return NextResponse.json({ error: "Assignment is already published" }, { status: 409 });
    }

    // Update assignment to published
    await profQuery(
      `UPDATE prof_assignments SET published = true WHERE id = $1 AND user_id = $2`,
      [assignmentIdInt, uidInt]
    );

    console.log(`Assignment ${assignmentIdInt} published successfully`);
    return NextResponse.json({ success: true, message: "Assignment published" }, { status: 200 });
  } catch (error) {
    console.error("Error publishing assignment:", error);
    return NextResponse.json({ error: "Failed to publish assignment" }, { status: 500 });
  }
}
