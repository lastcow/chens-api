import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { prisma } from "@/lib/prisma";

// POST /api/admin/credits — give credits to a user (admin only)
// Body: { target_user_id, amount, description? }
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  // Verify caller is ADMIN
  const caller = await prisma.user.findUnique({ where: { id: uid }, select: { role: true } });
  if (caller?.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { target_user_id, amount, description } = await req.json();
  if (!target_user_id || !amount || Number(amount) <= 0) {
    return NextResponse.json({ error: "Missing target_user_id or invalid amount" }, { status: 400 });
  }

  const balRows = await profQuery<{ credits: string }>(
    `INSERT INTO user_profile (user_id, credits)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET credits = user_profile.credits + $2
     RETURNING credits::text`,
    [target_user_id, Number(amount)]
  );
  const balanceAfter = parseFloat(balRows[0]?.credits ?? "0");

  await profQuery(
    `INSERT INTO credit_transactions (user_id, type, amount, description, ref_id, balance_after)
     VALUES ($1, 'credit', $2, $3, $4, $5)`,
    [target_user_id, Number(amount), description ?? `System credit from admin`, uid, balanceAfter]
  );

  return NextResponse.json({ ok: true, balance_after: balanceAfter });
}
