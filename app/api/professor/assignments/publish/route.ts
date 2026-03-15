import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { decryptCanvasToken } from "@/lib/canvas-crypto";

const CANVAS_BASE = (process.env.CANVAS_BASE_URL ?? "https://frostburg.instructure.com").replace(/\/api\/v1\/?$/, "");

export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  try {
    const { assignment_id, due_at } = await req.json();
    if (!assignment_id) {
      return NextResponse.json({ error: "Missing assignment_id" }, { status: 400 });
    }

    const assignmentIdInt = parseInt(assignment_id);
    console.log(`Publish request: assignment_id=${assignmentIdInt}, uid=${uid}, due_at=${due_at}`);

    const assignment = await profQuery(
      `SELECT a.id, a.canvas_id, a.user_id, a.published, c.canvas_id AS course_canvas_id
       FROM prof_assignments a
       JOIN prof_courses c ON c.id = a.course_id
       WHERE a.id = $1 AND a.user_id = $2`,
      [assignmentIdInt, uid]
    );

    if (!assignment || assignment.length === 0) {
      return NextResponse.json({ error: "Assignment not found or you don't have permission to publish it" }, { status: 404 });
    }

    if (assignment[0].published) {
      return NextResponse.json({ error: "Assignment is already published" }, { status: 409 });
    }

    const { canvas_id: assignmentCanvasId, course_canvas_id } = assignment[0];

    // Get user's Canvas token
    const tokenRows = await profQuery<{ canvas_token: string }>(
      `SELECT up.canvas_token FROM user_profile up WHERE up.user_id = $1`, [uid]
    );
    const token = tokenRows[0]?.canvas_token ? await decryptCanvasToken(tokenRows[0].canvas_token) : null;
    if (!token) {
      return NextResponse.json({ error: "Canvas token not found. Please reconnect your Canvas account." }, { status: 400 });
    }

    // Build Canvas assignment payload
    const canvasPayload: Record<string, unknown> = { published: true };
    if (due_at) canvasPayload.due_at = due_at;

    // Call Canvas API to publish the assignment
    const canvasRes = await fetch(
      `${CANVAS_BASE}/api/v1/courses/${course_canvas_id}/assignments/${assignmentCanvasId}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ assignment: canvasPayload }),
      }
    );

    if (!canvasRes.ok) {
      const errText = await canvasRes.text();
      console.error(`Canvas API error ${canvasRes.status}: ${errText}`);
      return NextResponse.json({ error: `Canvas API error: ${canvasRes.status}` }, { status: 502 });
    }

    // Update local DB to reflect published state and due date
    if (due_at) {
      await profQuery(
        `UPDATE prof_assignments SET published = true, due_at = $3 WHERE id = $1 AND user_id = $2`,
        [assignmentIdInt, uid, due_at]
      );
    } else {
      await profQuery(
        `UPDATE prof_assignments SET published = true WHERE id = $1 AND user_id = $2`,
        [assignmentIdInt, uid]
      );
    }

    console.log(`Assignment ${assignmentIdInt} (canvas_id=${assignmentCanvasId}) published successfully`);
    return NextResponse.json({ success: true, message: "Assignment published" }, { status: 200 });
  } catch (error) {
    console.error("Error publishing assignment:", error);
    return NextResponse.json({ error: "Failed to publish assignment" }, { status: 500 });
  }
}
