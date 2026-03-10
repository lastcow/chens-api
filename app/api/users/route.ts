import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey, requireAdmin } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

// GET /api/users — list all users (admin only)
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true, image: true, oauth_provider: true, suspended: true },
    orderBy: { createdAt: "desc" },
  });

  // Fetch credits for all users
  const creditRows = await profQuery<{ user_id: string; credits: string }>(
    `SELECT user_id, COALESCE(credits, 0)::text AS credits FROM user_profile`, []
  );
  const creditMap = Object.fromEntries(creditRows.map(r => [r.user_id, parseFloat(r.credits)]));

  const usersWithCredits = users.map(u => ({ ...u, credits: creditMap[u.id] ?? 0 }));

  return NextResponse.json({ users: usersWithCredits });
}
