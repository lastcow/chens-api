import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/auth";

// GET /api/professor/grade-request — list requests for this user
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const requests = await prisma.profRequest.findMany({
    where: { user_id: uid },
    orderBy: { created_at: "desc" },
  });

  return NextResponse.json({ requests });
}

// POST /api/professor/grade-request — create a grade request
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const body = await req.json();
  const { assignment_id, course_canvas_id, assignment_name, course_name, notes } = body;

  if (!assignment_id || !course_canvas_id || !assignment_name) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Check if already requested (pending or in_progress)
  const existing = await prisma.profRequest.findFirst({
    where: {
      user_id: uid,
      assignment_id: Number(assignment_id),
      status: { in: ["pending", "in_progress"] },
    },
  });

  if (existing) {
    return NextResponse.json({ error: "Already requested", request: existing }, { status: 409 });
  }

  const request = await prisma.profRequest.create({
    data: {
      user_id: uid,
      assignment_id: Number(assignment_id),
      course_canvas_id: Number(course_canvas_id),
      assignment_name,
      course_name: course_name ?? "",
      notes: notes ?? null,
    },
  });

  return NextResponse.json({ request }, { status: 201 });
}
