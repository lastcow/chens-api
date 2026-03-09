import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/auth";
import { encrypt, decrypt, maskToken } from "@/lib/crypto";

// GET /api/user/canvas-token?userId=xxx — returns masked token + whether it's set
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const profile = await prisma.userProfile.findUnique({
    where: { user_id: userId },
    select: { canvas_token: true },
  });

  const isSet = !!profile?.canvas_token;
  const masked = isSet ? maskToken(decrypt(profile!.canvas_token!)) : null;

  return NextResponse.json({ isSet, masked });
}

// PUT /api/user/canvas-token — save encrypted token
export async function PUT(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const { userId, token } = await req.json();
  if (!userId || !token) return NextResponse.json({ error: "userId and token required" }, { status: 400 });

  // Validate token against Canvas before saving
  const testRes = await fetch(`${process.env.CANVAS_BASE_URL}/courses?enrollment_state=active&per_page=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!testRes.ok) {
    return NextResponse.json({ error: "Invalid Canvas token — check and try again" }, { status: 400 });
  }

  const encrypted = encrypt(token);

  await prisma.userProfile.upsert({
    where:  { user_id: userId },
    update: { canvas_token: encrypted },
    create: { user_id: userId, canvas_token: encrypted },
  });

  return NextResponse.json({ success: true });
}

// POST /api/user/canvas-token/decrypt — internal: get decrypted token for agent tasks
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const profile = await prisma.userProfile.findUnique({
    where: { user_id: userId },
    select: { canvas_token: true },
  });

  if (!profile?.canvas_token) return NextResponse.json({ error: "No Canvas token saved" }, { status: 404 });

  return NextResponse.json({ token: decrypt(profile.canvas_token) });
}
