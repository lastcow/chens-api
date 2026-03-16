import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";
import { sendInviteEmail } from "@/lib/mailgun";
import { randomBytes } from "crypto";

// DELETE /api/msbiz/admin/invite/:id — revoke invitation
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const perm = await requireMsbizPermission(req, "admin.invite");
  if (perm instanceof NextResponse) return perm;
  const { id } = await params;

  await profQuery(
    `UPDATE msbiz_invitations SET status = 'revoked' WHERE id = $1 AND status = 'pending'`,
    [id]
  );
  return NextResponse.json({ ok: true });
}

// POST /api/msbiz/admin/invite/:id/resend — resend invitation
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const perm = await requireMsbizPermission(req, "admin.invite");
  if (perm instanceof NextResponse) return perm;
  const { uid } = perm;
  const { id } = await params;

  const rows = await profQuery<{ email: string; role_name: string }>(
    `SELECT email, role_name FROM msbiz_invitations WHERE id = $1`, [id]
  );
  if (!rows.length) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });

  const token = randomBytes(32).toString("hex");
  await profQuery(
    `UPDATE msbiz_invitations SET token = $1, status = 'pending', expires_at = now() + INTERVAL '7 days' WHERE id = $2`,
    [token, id]
  );

  const inviterRows = await profQuery<{ email: string }>(`SELECT email FROM "User" WHERE id = $1`, [uid]);
  await sendInviteEmail({ to: rows[0].email, invitedBy: inviterRows[0]?.email ?? "Admin", token, roleName: rows[0].role_name });

  return NextResponse.json({ ok: true, message: "Invitation resent" });
}
