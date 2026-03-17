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
    `SELECT a.id, a.email, a.display_name, a.status, a.notes, a.balance,
            a.owner_id, a.order_ids, a.last_used_at, a.created_at, a.updated_at,
            u.name AS owner_name, u.email AS owner_email
     FROM msbiz_accounts a
     LEFT JOIN "User" u ON u.id = a.owner_id
     WHERE a.user_id = $1
     ORDER BY a.created_at DESC`,
    [uid]
  );
  return NextResponse.json({ accounts });
}

// POST /api/msbiz/accounts
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "accounts.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const { email, password, display_name, notes, balance, order_ids } = await req.json();
  if (!email || !password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });

  const password_enc = encrypt(password);

  const rows = await profQuery(
    `INSERT INTO msbiz_accounts (user_id, email, password_enc, display_name, notes, balance, owner_id, order_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, email, display_name, status, balance, owner_id, order_ids, created_at`,
    [uid, email.toLowerCase(), password_enc, display_name ?? null, notes ?? null,
     balance ?? 0, uid, order_ids ? JSON.stringify(order_ids) : '[]']
  );
  return NextResponse.json({ account: rows[0] }, { status: 201 });
}
