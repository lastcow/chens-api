import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/auth";

// POST /api/auth/google
// Upserts a Google OAuth user. Called after Google sign-in succeeds.
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  try {
    const { email, name, image, oauth_provider, oauth_id } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const user = await prisma.user.upsert({
      where: { email },
      update: {
        name, image, emailVerified: new Date(),
        ...(oauth_provider && { oauth_provider }),
        ...(oauth_id && { oauth_id }),
      },
      create: {
        email, name, image, emailVerified: new Date(),
        oauth_provider: oauth_provider ?? "google",
        oauth_id: oauth_id ?? null,
      },
      select: { id: true, name: true, email: true, role: true, image: true },
    });

    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
