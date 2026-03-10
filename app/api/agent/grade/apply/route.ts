import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { decryptCanvasToken } from "@/lib/canvas-crypto";
import { profQuery } from "@/lib/prof-db";

export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const body = await req.json();
  const { course_canvas_id, assignment_canvas_id, grades } = body;
  if (!course_canvas_id || !assignment_canvas_id || !grades) {
    return NextResponse.json({ error: "course_canvas_id, assignment_canvas_id, grades required" }, { status: 400 });
  }

  const rows = await profQuery<{ canvas_token: string | null }>(`SELECT canvas_token FROM user_profile WHERE user_id = $1`, [uid]);
  if (!rows.length || !rows[0].canvas_token) {
    return NextResponse.json({ error: "No Canvas token found for user" }, { status: 400 });
  }
  const canvasToken = decryptCanvasToken(rows[0].canvas_token);

  const agentUrl = process.env.CHENS_AGENT_URL ?? "https://chens-agent.fly.dev";
  const agentKey = process.env.AGENT_API_KEY!;

  const resp = await fetch(`${agentUrl}/grade/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": agentKey },
    body: JSON.stringify({ course_canvas_id, assignment_canvas_id, canvas_token: canvasToken, grades }),
  });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
