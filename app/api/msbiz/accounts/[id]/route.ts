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

  const rows = await profQuery<{ id: string; email: string; password_enc: string; display_name: string; status: string; notes: string }>(
    `SELECT id, email, password_enc, display_name, status, notes, last_used_at, created_at FROM msbiz_accounts WHERE id = $1 AND user_id = $2`,
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

  const { email, password, display_name, status, notes } = await req.json();
  const password_enc = password ? encrypt(password) : null;

  await profQuery(
    `UPDATE msbiz_accounts SET
       email = COALESCE($1, email),
       password_enc = COALESCE($2, password_enc),
       display_name = COALESCE($3, display_name),
       status = COALESCE($4, status),
       notes = COALESCE($5, notes),
       updated_at = now()
     WHERE id = $6 AND user_id = $7`,
    [email ?? null, password_enc, display_name ?? null, status ?? null, notes ?? null, id, uid]
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
