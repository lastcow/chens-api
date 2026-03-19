import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";
import { encrypt, decrypt } from "@/lib/crypto";

// GET /api/msbiz/accounts/:id — include decrypted password for authorized users
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "accounts.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;

  const rows = await profQuery<{ id: string; email: string; password_enc: string; display_name: string; status: string; notes: string; balance: number; owner_id: string; owner_name: string; owner_email: string }>(
    `SELECT a.id, a.email, a.password_enc, a.display_name, a.status, a.notes,
            a.balance, a.owner_id, a.last_used_at, a.created_at,
            u.name AS owner_name, u.email AS owner_email
     FROM msbiz_accounts a
     LEFT JOIN "User" u ON u.id = a.owner_id
     WHERE a.id = $1 AND a.user_id = $2`,
    [id, uid]
  );
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { password_enc, ...rest } = rows[0];
  // Reveal password only to accounts.manage users
  const canManage = await (await import("@/lib/msbiz-auth")).hasMsbizPermission(uid, "accounts.manage");
  return NextResponse.json({
    account: {
      ...rest,
      ...(canManage ? { password: decrypt(password_enc) } : {}),
    }
  });
}

// PUT /api/msbiz/accounts/:id
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "accounts.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;

  const { email, password, display_name, status, notes, balance, owner_id } = await req.json();
  const password_enc = password ? encrypt(password) : null;

  await profQuery(
    `UPDATE msbiz_accounts SET
       email        = COALESCE($1, email),
       password_enc = COALESCE($2, password_enc),
       display_name = COALESCE($3, display_name),
       status       = COALESCE($4, status),
       notes        = COALESCE($5, notes),
       balance      = COALESCE($6, balance),
       owner_id     = $7,
       updated_at   = now()
     WHERE id = $8 AND user_id = $9`,
    [email?.toLowerCase() ?? null, password_enc, display_name ?? null, status ?? null,
     notes ?? null, balance != null ? balance : null,
     owner_id !== undefined ? (owner_id || null) : undefined,
     id, uid]
  );
  return NextResponse.json({ ok: true });
}

// DELETE /api/msbiz/accounts/:id
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "accounts.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;

  await profQuery(`DELETE FROM msbiz_accounts WHERE id = $1 AND user_id = $2`, [id, uid]);
  return NextResponse.json({ ok: true });
}
