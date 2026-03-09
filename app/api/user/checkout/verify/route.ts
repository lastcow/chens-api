import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { requireApiKey } from "@/lib/auth";

// POST /api/user/checkout/verify — confirm Stripe session and activate module
// Handles the race between Stripe redirect and webhook; idempotent
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const { stripeSessionId, userId } = await req.json();
  if (!stripeSessionId || !userId) {
    return NextResponse.json({ error: "Missing stripeSessionId or userId" }, { status: 400 });
  }

  const session = await stripe.checkout.sessions.retrieve(stripeSessionId);

  // Only activate for paid/complete sessions
  if (session.payment_status !== "paid" && session.status !== "complete") {
    return NextResponse.json({ verified: false, reason: "Payment not confirmed" });
  }

  const { moduleId, paymentType } = (session.metadata ?? {}) as { moduleId?: string; paymentType?: string };
  if (!moduleId || !paymentType) {
    return NextResponse.json({ error: "Missing metadata in session" }, { status: 400 });
  }

  // Compute expiry for subscriptions
  const expiresAt =
    paymentType === "annual"  ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) :
    paymentType === "monthly" ? new Date(Date.now() + 31  * 24 * 60 * 60 * 1000) :
    null;

  // Activate module (upsert — idempotent)
  const userMod = await prisma.userModule.upsert({
    where:  { user_id_module: { user_id: userId, module: moduleId } },
    update: { enabled: true, payment_type: paymentType, expires_at: expiresAt, activated_at: new Date(),
               stripe_subscription_id: session.subscription as string ?? null },
    create: { user_id: userId, module: moduleId, enabled: true, payment_type: paymentType,
               expires_at: expiresAt, activated_at: new Date(),
               stripe_subscription_id: session.subscription as string ?? null },
  });

  // Mark payment completed (if not already done by webhook)
  await prisma.payment.updateMany({
    where: { stripe_session_id: stripeSessionId, status: "pending" },
    data: {
      status: "completed",
      stripe_payment_intent_id: session.payment_intent as string ?? null,
      stripe_subscription_id: session.subscription as string ?? null,
    },
  });

  return NextResponse.json({
    verified: true,
    moduleId,
    paymentType,
    expiresAt: userMod.expires_at,
    activatedAt: userMod.activated_at,
  });
}
