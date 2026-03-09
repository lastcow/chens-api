import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { requireApiKey } from "@/lib/auth";

// POST /api/user/subscription/cancel
// Cancels at period end — user keeps access until expires_at
export async function POST(req: NextRequest) {
  try {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const { userId, moduleId } = await req.json();
  if (!userId || !moduleId) {
    return NextResponse.json({ error: "Missing userId or moduleId" }, { status: 400 });
  }

  const userMod = await prisma.userModule.findFirst({
    where: { user_id: userId, module: moduleId },
  });

  if (!userMod) {
    return NextResponse.json({ error: "Module not found for user" }, { status: 404 });
  }

  if (!userMod.stripe_subscription_id) {
    return NextResponse.json({ error: "No active subscription found" }, { status: 400 });
  }

  if (userMod.cancelled) {
    return NextResponse.json({ error: "Subscription already cancelled" }, { status: 400 });
  }

  // Cancel at period end on Stripe — user keeps access until current period ends
  const sub = await stripe.subscriptions.update(userMod.stripe_subscription_id, {
    cancel_at_period_end: true,
  });

  // Use Stripe's actual period end as expires_at (source of truth)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expiresAt = new Date((sub as any).current_period_end * 1000);

  await prisma.userModule.updateMany({
    where: { user_id: userId, module: moduleId },
    data: { cancelled: true, expires_at: expiresAt },
  });

  return NextResponse.json({
    cancelled: true,
    expiresAt: expiresAt.toISOString(),
    message: "Subscription cancelled. Access continues until " + expiresAt.toLocaleDateString(),
  });
  } catch (err) {
    console.error("[cancel subscription]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
