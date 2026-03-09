import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/auth";

// GET /api/user/payments — purchase history for a user
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const payments = await prisma.payment.findMany({
    where: { user_id: userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ payments });
}
