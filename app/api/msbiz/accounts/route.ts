import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";
import { encrypt, decrypt } from "@/lib/crypto";

// GET /api/msbiz/accounts
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "accounts.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const accounts = await profQuery(
    `SELECT id, email, display_name, status, notes, last_used_at, created_at, updated_at
     FROM msbiz_accounts WHERE user_id = $1 ORDER BY created_at DESC`,
    [uid]
  );
  // Never return password_enc
  return NextResponse.json({ accounts });
}

// POST /api/msbiz/accounts
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "accounts.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const { email, password, display_name, notes } = await req.json();
  if (!email || !password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });

  const password_enc = encrypt(password);

  const rows = await profQuery(
    `INSERT INTO msbiz_accounts (user_id, email, password_enc, display_name, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, display_name, status, created_at`,
    [uid, email.toLowerCase(), password_enc, display_name ?? null, notes ?? null]
  );
  return NextResponse.json({ account: rows[0] }, { status: 201 });
}
