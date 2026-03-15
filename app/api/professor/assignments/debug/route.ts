import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const assignmentId = req.nextUrl.searchParams.get("id") || "144";
  const uidInt = parseInt(uid);
  const assignmentIdInt = parseInt(assignmentId);

  try {
    // Check if assignment exists at all
    const allAssignments = await profQuery(
      `SELECT id, user_id, published, name FROM prof_assignments WHERE id = $1`,
      [assignmentIdInt]
    );

    // Check if user has any assignments
    const userAssignments = await profQuery(
      `SELECT id, user_id, published, name FROM prof_assignments WHERE user_id = $1 LIMIT 5`,
      [uidInt]
    );

    // Check the specific assignment for this user
    const userAssignment = await profQuery(
      `SELECT id, user_id, published, name FROM prof_assignments WHERE id = $1 AND user_id = $2`,
      [assignmentIdInt, uidInt]
    );

    return NextResponse.json({
      debug: {
        uid_parsed: uidInt,
        assignment_id: assignmentIdInt,
        assignment_exists: allAssignments,
        user_assignments: userAssignments,
        user_assignment_match: userAssignment
      }
    });
  } catch (error) {
    console.error("Debug error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
