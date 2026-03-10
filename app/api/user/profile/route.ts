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
  }>(
    `SELECT id, name, email, role, image,
       (password IS NOT NULL AND password != '') AS has_password,
       oauth_provider, oauth_id,
       "createdAt" AS created_at
     FROM "User" WHERE id = $1`,
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
