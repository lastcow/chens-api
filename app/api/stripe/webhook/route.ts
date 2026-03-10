import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { profQuery } from "@/lib/prof-db";

export const config = { api: { bodyParser: false } };

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;
  const secret = process.env.STRIPE_WEBHOOK_SECRET!;

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    return NextResponse.json({ error: `Webhook error: ${err}` }, { status: 400 });
  }

  const activate = async (userId: string, moduleId: string, paymentType: string, subscriptionId?: string) => {
    const expiresAt = paymentType === "annual"
      ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      : paymentType === "monthly"
      ? new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)
      : null;

    const updateData = {
      enabled: true,
      payment_type: paymentType,
      stripe_subscription_id: subscriptionId ?? null,
      expires_at: expiresAt,
      activated_at: new Date(),
    };

    const updated = await prisma.userModule.updateMany({
      where: { user_id: userId, module: moduleId },
      data: updateData,
    });

    if (updated.count === 0) {
      await prisma.userModule.create({
        data: { user_id: userId, module: moduleId, ...updateData },
      });
    }
  };

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as { metadata?: Record<string, string>; payment_intent?: string; subscription?: string; id: string };
    const { userId, moduleId, paymentType, type: metaType, credits } = session.metadata ?? {};

    // Credit purchase fulfillment
    if (metaType === "credit_purchase" && userId && credits) {
      const amount = parseFloat(credits);
      const balRows = await profQuery<{ credits: string }>(
        `INSERT INTO user_profile (user_id, credits)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET credits = user_profile.credits + $2
         RETURNING credits::text`,
        [userId, amount]
      );
      const balanceAfter = parseFloat(balRows[0]?.credits ?? "0");
      await profQuery(
        `INSERT INTO credit_transactions (user_id, type, amount, description, ref_id, balance_after)
         VALUES ($1, 'purchase', $2, $3, $4, $5)`,
        [userId, amount, `Purchased ${amount} credits`, session.id, balanceAfter]
      );
    }

    // Module purchase fulfillment
    if (userId && moduleId && paymentType) {
      await activate(userId, moduleId, paymentType, session.subscription as string | undefined);
      await prisma.payment.updateMany({
        where: { stripe_session_id: session.id },
        data: {
          status: "completed",
          stripe_payment_intent_id: session.payment_intent as string | undefined,
          stripe_subscription_id: session.subscription as string | undefined,
        },
      });
    }
  }

  if (event.type === "customer.subscription.deleted") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub = event.data.object as any as { id: string; current_period_end?: number };
    await prisma.userModule.updateMany({
      where: { stripe_subscription_id: sub.id },
      data: {
        enabled: false,
        cancelled: true,
        expires_at: sub.current_period_end ? new Date(sub.current_period_end * 1000) : new Date(),
      },
    });
  }

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as { subscription?: string };
    if (invoice.subscription) {
      await prisma.userModule.updateMany({
        where: { stripe_subscription_id: invoice.subscription as string },
        data: { enabled: false },
      });
    }
  }

  return NextResponse.json({ received: true });
}
