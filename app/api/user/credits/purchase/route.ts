import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

// POST /api/user/credits/purchase — create Stripe checkout for credits
// Body: { credits: number, success_url: string, cancel_url: string }
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const body = await req.json();
  const credits = Math.max(100, Math.round(Number(body.credits ?? 100)));
  const amountCents = credits * 100; // 1 credit = $1.00 = 100 cents

  // Fetch user email for pre-fill
  const user = await prisma.user.findUnique({ where: { id: uid }, select: { email: true } });

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    customer_email: user?.email ?? undefined,
    line_items: [{
      price_data: {
        currency: "usd",
        unit_amount: amountCents,
        product_data: {
          name: `${credits} AI Grading Credits`,
          description: `${credits} credits · $1.00 per credit · 0.1 credit per submission graded`,
        },
      },
      quantity: 1,
    }],
    metadata: { user_id: uid, credits: credits.toString(), type: "credit_purchase" },
    success_url: body.success_url,
    cancel_url:  body.cancel_url,
  });

  return NextResponse.json({ url: session.url, session_id: session.id });
}
