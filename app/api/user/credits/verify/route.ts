import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { profQuery } from "@/lib/prof-db";

// POST /api/user/credits/verify — verify a Stripe checkout session and credit the user
// Idempotent: checks credit_transactions for duplicate session before crediting
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const { session_id } = await req.json();
  if (!session_id) return NextResponse.json({ error: "Missing session_id" }, { status: 400 });

  // Check if already processed (idempotency)
  const existing = await profQuery<{ id: number }>(
    `SELECT id FROM credit_transactions WHERE ref_id = $1 AND type = 'purchase'`, [session_id]
  );
  if (existing.length > 0) {
    const bal = await profQuery<{ credits: string }>(
      `SELECT COALESCE(credits, 0)::text AS credits FROM user_profile WHERE user_id = $1`, [uid]
    );
    return NextResponse.json({ ok: true, already_processed: true, balance: parseFloat(bal[0]?.credits ?? "0") });
  }

  // Verify with Stripe
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(session_id);
  } catch {
    return NextResponse.json({ error: "Invalid session_id" }, { status: 400 });
  }
  if (session.payment_status !== "paid") {
    return NextResponse.json({ error: "Payment not completed", status: session.payment_status }, { status: 402 });
  }

  // Validate session belongs to this user
  const meta = session.metadata ?? {};
  if (meta.user_id !== uid || meta.type !== "credit_purchase") {
    return NextResponse.json({ error: "Session mismatch" }, { status: 403 });
  }

  const amount = parseFloat(meta.credits ?? "0");
  if (amount <= 0) return NextResponse.json({ error: "Invalid credit amount" }, { status: 400 });

  // Credit the user
  const balRows = await profQuery<{ credits: string }>(
    `INSERT INTO user_profile (id, user_id, credits)
     VALUES (gen_random_uuid()::text, $1, $2)
     ON CONFLICT (user_id) DO UPDATE SET credits = user_profile.credits + $2
     RETURNING credits::text`,
    [uid, amount]
  );
  const balanceAfter = parseFloat(balRows[0]?.credits ?? "0");

  await profQuery(
    `INSERT INTO credit_transactions (user_id, type, amount, description, ref_id, balance_after)
     VALUES ($1, 'purchase', $2, $3, $4, $5)`,
    [uid, amount, `Purchased ${amount} credits`, session_id, balanceAfter]
  );

  return NextResponse.json({ ok: true, credits_added: amount, balance: balanceAfter });
}
