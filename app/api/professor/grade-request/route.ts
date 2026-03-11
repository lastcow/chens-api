import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

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

// Helper: deduct credits and log transaction
async function deductCredits(uid: string, amount: number, description: string, refId: string) {
  const balRows = await profQuery<{ credits: string }>(
    `UPDATE user_profile SET credits = credits - $1 WHERE user_id = $2
     RETURNING credits::text`, [amount, uid]
  );
  const balanceAfter = parseFloat(balRows[0]?.credits ?? "0");
  await profQuery(
    `INSERT INTO credit_transactions (user_id, type, amount, description, ref_id, balance_after)
     VALUES ($1, 'usage', $2, $3, $4, $5)`,
    [uid, -amount, description, refId, balanceAfter]
  );
  return balanceAfter;
}

// Helper: refund credits and log transaction
async function refundCredits(uid: string, amount: number, description: string, refId: string) {
  const balRows = await profQuery<{ credits: string }>(
    `UPDATE user_profile SET credits = credits + $1 WHERE user_id = $2
     RETURNING credits::text`, [amount, uid]
  );
  const balanceAfter = parseFloat(balRows[0]?.credits ?? "0");
  await profQuery(
    `INSERT INTO credit_transactions (user_id, type, amount, description, ref_id, balance_after)
     VALUES ($1, 'refund', $2, $3, $4, $5)`,
    [uid, amount, description, refId, balanceAfter]
  );
  return balanceAfter;
}

// POST /api/professor/grade-request — create, cancel grade request
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { assignment_id, course_canvas_id, assignment_name, course_name, notes, ungraded_count } = body as Record<string, unknown>;

  if (!assignment_id) return NextResponse.json({ error: "Missing assignment_id" }, { status: 400 });

  // ── Cancel action ─────────────────────────────────────────────
  if (body.action === "cancel") {
    const target = await prisma.profRequest.findFirst({
      where: { user_id: uid, assignment_id: Number(assignment_id), status: { in: ["pending", "in_progress"] } },
    });
    if (!target) return NextResponse.json({ error: "No active request to cancel" }, { status: 404 });

    // Reject any staging rows
    await profQuery(
      `UPDATE prof_grade_staging SET status = 'rejected', updated_at = now()
       WHERE request_id = $1 AND user_id = $2 AND status = 'pending'`,
      [target.id, uid]
    );

    // Refund credits if metadata has cost
    if (target.notes) {
      try {
        const meta = JSON.parse(target.notes);
        if (meta.credit_cost > 0) {
          await refundCredits(uid, meta.credit_cost, `Refund: ${target.assignment_name}`, target.id);
        }
      } catch { /* no metadata */ }
    }

    await prisma.profRequest.update({ where: { id: target.id }, data: { status: "completed" } });
    return NextResponse.json({ ok: true });
  }

  // ── Create action ─────────────────────────────────────────────
  if (!course_canvas_id || !assignment_name) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Check duplicate
  const existing = await prisma.profRequest.findFirst({
    where: { user_id: uid, assignment_id: Number(assignment_id), status: { in: ["pending", "in_progress"] } },
  });
  if (existing) return NextResponse.json({ error: "Already requested", request: existing }, { status: 409 });

  // Get cost per submission
  const configRows = await profQuery<{ value: string }>(
    `SELECT value FROM prof_config WHERE key = 'grading_cost_per_submission'`, []
  );
  const costPerSub = parseFloat(configRows[0]?.value ?? "0.1");
  const count = Math.max(0, Number(ungraded_count ?? 0));
  const totalCost = parseFloat((costPerSub * count).toFixed(2));

  // Check credit balance
  const balRows = await profQuery<{ credits: string }>(
    `SELECT COALESCE(credits, 0)::text AS credits FROM user_profile WHERE user_id = $1`, [uid]
  );
  const balance = parseFloat(balRows[0]?.credits ?? "0");

  if (totalCost > 0 && balance < totalCost) {
    return NextResponse.json({
      error: "Insufficient credits",
      required: totalCost,
      balance,
    }, { status: 402 });
  }

  // Deduct credits upfront
  if (totalCost > 0) {
    await deductCredits(uid, totalCost, `Grading: ${assignment_name as string} (${count} submissions)`, "pending");
  }

  let request;
  try {
    // Create request — store credit_cost in notes for potential refund
    request = await prisma.profRequest.create({
      data: {
        user_id: uid,
        assignment_id: Number(assignment_id),
        course_canvas_id: Number(course_canvas_id),
        assignment_name: assignment_name as string,
        course_name: (course_name as string) ?? "",
        notes: JSON.stringify({ credit_cost: totalCost, submission_count: count, ...(notes ? { note: notes } : {}) }),
      },
    });
  } catch (err: unknown) {
    // Roll back credits if request creation fails
    if (totalCost > 0) {
      await refundCredits(uid, totalCost, `Refund (create failed): ${assignment_name as string}`, "create-failed");
    }
    console.error("[grade-request] prisma.create failed:", err);
    return NextResponse.json({ error: "Failed to create request" }, { status: 500 });
  }

  // Update the credit transaction ref_id now that we have the request id (best-effort)
  if (totalCost > 0) {
    try {
      await profQuery(
        `UPDATE credit_transactions SET ref_id = $1
         WHERE user_id = $2 AND ref_id = 'pending' AND type = 'usage'
         ORDER BY created_at DESC LIMIT 1`,
        [request.id, uid]
      );
    } catch (err) {
      console.error("[grade-request] ref_id update failed (non-fatal):", err);
    }
  }

  return NextResponse.json({ request, credit_cost: totalCost, balance_after: balance - totalCost }, { status: 201 });
}
