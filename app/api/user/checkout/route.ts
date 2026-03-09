import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/auth";
import { stripe } from "@/lib/stripe";

// POST /api/user/checkout — create Stripe checkout session
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const { userId, moduleId, paymentType, userEmail, successUrl, cancelUrl } = await req.json();
  if (!userId || !moduleId || !paymentType) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const mod = await prisma.module.findUnique({ where: { id: moduleId } });
  if (!mod) return NextResponse.json({ error: "Module not found" }, { status: 404 });

  // Free activation — no Stripe needed
  if (mod.is_free || paymentType === "free") {
    await prisma.userModule.upsert({
      where: { user_id_module: { user_id: userId, module: moduleId } },
      update: { enabled: true, payment_type: "free", activated_at: new Date() },
      create: { user_id: userId, module: moduleId, enabled: true, payment_type: "free", activated_at: new Date() },
    });
    return NextResponse.json({ activated: true });
  }

  // Determine Stripe price ID
  let priceId: string | null = null;
  let mode: "payment" | "subscription" = "subscription";

  if (paymentType === "one_time") {
    priceId = mod.stripe_price_one_time_id;
    mode = "payment";
  } else if (paymentType === "monthly") {
    priceId = mod.stripe_price_monthly_id;
  } else if (paymentType === "annual") {
    priceId = mod.stripe_price_annual_id;
  }

  if (!priceId) {
    return NextResponse.json({ error: "No Stripe price configured for this option" }, { status: 400 });
  }

  const session = await stripe.checkout.sessions.create({
    mode,
    customer_email: userEmail,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl || `${process.env.NEXTAUTH_URL}/dashboard/modules?success=1`,
    cancel_url: cancelUrl || `${process.env.NEXTAUTH_URL}/dashboard/modules?cancelled=1`,
    metadata: { userId, moduleId, paymentType },
  });

  // Record pending payment
  await prisma.payment.create({
    data: {
      user_id: userId,
      module_id: moduleId,
      stripe_session_id: session.id,
      payment_type: paymentType,
      amount: paymentType === "one_time" ? mod.price_one_time : paymentType === "monthly" ? mod.price_monthly : mod.price_annual,
      status: "pending",
    },
  });

  return NextResponse.json({ url: session.url });
}
