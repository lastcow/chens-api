import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  try {
    const { assignment_id } = await req.json();
    if (!assignment_id) {
      return NextResponse.json({ error: "Missing assignment_id" }, { status: 400 });
    }

    const assignmentIdInt = parseInt(assignment_id);
    console.log(`Publish request: assignment_id=${assignmentIdInt}, uid=${uid}`);

    // Verify assignment exists and belongs to this user
    const assignment = await profQuery(
      `SELECT a.id, a.user_id, a.published FROM prof_assignments a
       WHERE a.id = $1 AND a.user_id = $2`,
      [assignmentIdInt, uid]
    );

    console.log(`Query result:`, assignment);

    if (!assignment || assignment.length === 0) {
      // Try to see if assignment exists at all
      const anyAssignment = await profQuery(
        `SELECT a.id, a.user_id, a.published FROM prof_assignments a WHERE a.id = $1`,
        [assignmentIdInt]
      );
      console.log(`Assignment exists in DB:`, anyAssignment);
      
      return NextResponse.json({ 
        error: "Assignment not found or you don't have permission to publish it",
        debug: { assignment_id: assignmentIdInt, uid }
      }, { status: 404 });
    }

    if (assignment[0].published) {
      return NextResponse.json({ error: "Assignment is already published" }, { status: 409 });
    }

    // Update assignment to published
    await profQuery(
      `UPDATE prof_assignments SET published = true WHERE id = $1 AND user_id = $2`,
      [assignmentIdInt, uid]
    );

    console.log(`Assignment ${assignmentIdInt} published successfully`);
    return NextResponse.json({ success: true, message: "Assignment published" }, { status: 200 });
  } catch (error) {
    console.error("Error publishing assignment:", error);
    return NextResponse.json({ error: "Failed to publish assignment" }, { status: 500 });
  }
}
