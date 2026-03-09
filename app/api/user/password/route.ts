import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import bcrypt from "bcryptjs";

export async function PATCH(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  // Block OAuth users
  const accounts = await profQuery<{ provider: string }>(
    `SELECT provider FROM "Account" WHERE "userId" = $1 AND provider != 'credentials'`,
    [uid]
  );
  if (accounts.length > 0) {
    return NextResponse.json({ error: "Password change not available for OAuth accounts" }, { status: 403 });
  }

  const { current_password, new_password } = await req.json();
  if (!new_password || new_password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const [user] = await profQuery<{ password: string | null }>(
    `SELECT password FROM "User" WHERE id = $1`, [uid]
  );

  // If user has existing password, verify current
  if (user?.password) {
    if (!current_password) return NextResponse.json({ error: "Current password required" }, { status: 400 });
    const valid = await bcrypt.compare(current_password, user.password);
    if (!valid) return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  const hashed = await bcrypt.hash(new_password, 12);
  await profQuery(`UPDATE "User" SET password = $1 WHERE id = $2`, [hashed, uid]);

  return NextResponse.json({ success: true });
}
