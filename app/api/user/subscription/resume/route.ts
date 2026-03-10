import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { requireApiKey } from "@/lib/auth";

// POST /api/user/subscription/resume
// Reverses cancel_at_period_end — subscription continues normally
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

    if (!userMod) return NextResponse.json({ error: "Module not found for user" }, { status: 404 });
    if (!userMod.stripe_subscription_id) return NextResponse.json({ error: "No subscription found" }, { status: 400 });
    if (!userMod.cancelled) return NextResponse.json({ error: "Subscription is not cancelled" }, { status: 400 });

    // Check Stripe sub is still active (not fully expired)
    const sub = await stripe.subscriptions.retrieve(userMod.stripe_subscription_id);
    if (sub.status !== "active") {
      return NextResponse.json({ error: "Subscription has already expired and cannot be resumed" }, { status: 400 });
    }

    // Un-cancel: set cancel_at_period_end back to false
    await stripe.subscriptions.update(userMod.stripe_subscription_id, {
      cancel_at_period_end: false,
    });

    await prisma.userModule.updateMany({
      where: { user_id: userId, module: moduleId },
      data: { cancelled: false, expires_at: null },
    });

    return NextResponse.json({ resumed: true, message: "Subscription resumed successfully." });
  } catch (err) {
    console.error("[resume subscription]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
