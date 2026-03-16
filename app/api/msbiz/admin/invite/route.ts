import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission, MSBIZ_ROLE_PERMISSIONS } from "@/lib/msbiz-auth";
import { sendInviteEmail } from "@/lib/mailgun";
import { randomBytes } from "crypto";

// GET /api/msbiz/admin/invite — list pending invitations
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "admin.invite");
  if (result instanceof NextResponse) return result;

  const invites = await profQuery(
    `SELECT id, email, role_name, status, invited_by, expires_at, accepted_at, created_at
     FROM msbiz_invitations
     ORDER BY created_at DESC`
  );
  return NextResponse.json({ invites });
}

// POST /api/msbiz/admin/invite — send invitation
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "admin.invite");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const { email, role_name = "viewer", permissions: customPerms } = await req.json();
  if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });

  // Check no active invite already exists
  const existing = await profQuery(
    `SELECT id FROM msbiz_invitations WHERE email = $1 AND status = 'pending' AND expires_at > now()`,
    [email.toLowerCase()]
  );
  if (existing.length > 0) {
    return NextResponse.json({ error: "An active invitation already exists for this email" }, { status: 409 });
  }

  // Check user isn't already a member
  const member = await profQuery(
    `SELECT u.id FROM "User" u
     JOIN user_module_permissions p ON p.user_id = u.id AND p.module = 'msbiz'
     WHERE lower(u.email) = $1`,
    [email.toLowerCase()]
  );
  if (member.length > 0) {
    return NextResponse.json({ error: "This user already has access to MS Business" }, { status: 409 });
  }

  // Build permissions: role defaults merged with custom overrides
  const basePerms = MSBIZ_ROLE_PERMISSIONS[role_name] ?? MSBIZ_ROLE_PERMISSIONS.viewer;
  const permissions = { ...basePerms, ...(customPerms ?? {}) };

  // Get inviter name
  const inviterRows = await profQuery<{ email: string }>(
    `SELECT email FROM "User" WHERE id = $1`, [uid]
  );
  const inviterEmail = inviterRows[0]?.email ?? "An admin";

  const token = randomBytes(32).toString("hex");

  await profQuery(
    `INSERT INTO msbiz_invitations (email, role_name, permissions, token, invited_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [email.toLowerCase(), role_name, JSON.stringify(permissions), token, uid]
  );

  await sendInviteEmail({ to: email, invitedBy: inviterEmail, token, roleName: role_name });

  return NextResponse.json({ ok: true, message: `Invitation sent to ${email}` }, { status: 201 });
}
