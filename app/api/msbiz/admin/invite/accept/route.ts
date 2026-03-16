import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

// POST /api/msbiz/admin/invite/accept — accept invitation (called with session user)
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Must be logged in to accept invitation" }, { status: 401 });

  const { token } = await req.json();
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  // Find valid invitation
  const invites = await profQuery<{
    id: string; email: string; role_name: string; permissions: Record<string, boolean>;
  }>(
    `SELECT id, email, role_name, permissions FROM msbiz_invitations
     WHERE token = $1 AND status = 'pending' AND expires_at > now()`,
    [token]
  );

  if (!invites.length) {
    return NextResponse.json({ error: "Invitation is invalid or has expired" }, { status: 404 });
  }
  const invite = invites[0];

  // Verify logged-in user's email matches the invite
  const userRows = await profQuery<{ email: string }>(
    `SELECT email FROM "User" WHERE id = $1`, [uid]
  );
  if (!userRows.length) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (userRows[0].email.toLowerCase() !== invite.email.toLowerCase()) {
    return NextResponse.json(
      { error: "This invitation was sent to a different email address" },
      { status: 403 }
    );
  }

  // Grant module access
  await profQuery(
    `INSERT INTO user_module_permissions (user_id, module, role_name, permissions, granted_by)
     VALUES ($1, 'msbiz', $2, $3, 'invite')
     ON CONFLICT (user_id, module) DO NOTHING`,
    [uid, invite.role_name, JSON.stringify(invite.permissions)]
  );

  // Also add to UserModule table (for navbar detection)
  await profQuery(
    `INSERT INTO "UserModule" (user_id, module, enabled)
     VALUES ($1, 'msbiz', true)
     ON CONFLICT (user_id, module) DO UPDATE SET enabled = true`,
    [uid]
  );

  // Mark invitation accepted
  await profQuery(
    `UPDATE msbiz_invitations SET status = 'accepted', accepted_at = now() WHERE id = $1`,
    [invite.id]
  );

  return NextResponse.json({ ok: true, message: "Invitation accepted. Welcome to MS Business!" });
}
