import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const rows = await profQuery<{
    id: string; name: string; email: string; role: string;
    image: string | null; has_password: boolean; created_at: string;
    oauth_provider: string | null; oauth_id: string | null;
    credits: number;
  }>(
    `SELECT u.id, u.name, u.email, u.role, u.image,
       (u.password IS NOT NULL AND u.password != '') AS has_password,
       u.oauth_provider, u.oauth_id,
       u."createdAt" AS created_at,
       COALESCE(up.credits, 0) AS credits
     FROM "User" u
     LEFT JOIN user_profile up ON u.id = up.user_id
     WHERE u.id = $1`,
    [uid]
  );

  if (!rows.length) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const user = rows[0];

  // Determine provider: prefer stored oauth_provider, fallback to inference
  let providers: string[];
  if (user.oauth_provider) {
    providers = [user.oauth_provider];
  } else if (user.has_password) {
    providers = ["credentials"];
  } else {
    providers = ["google"]; // legacy fallback
  }

  return NextResponse.json({ user: { ...user, providers } });
}
