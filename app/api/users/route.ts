import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey, requireAdmin } from "@/lib/auth";

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

  return NextResponse.json({ users });
}
