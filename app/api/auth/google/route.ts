import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/auth";

// POST /api/auth/google
// Upserts a Google OAuth user. Called after Google sign-in succeeds.
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  try {
    const { email, name, image } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const user = await prisma.user.upsert({
      where: { email },
      update: { name, image, emailVerified: new Date() },
      create: { email, name, image, emailVerified: new Date() },
      select: { id: true, name: true, email: true, role: true, image: true },
    });

    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
