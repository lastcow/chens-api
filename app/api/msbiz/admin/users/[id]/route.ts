import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission, MSBIZ_ROLE_PERMISSIONS } from "@/lib/msbiz-auth";

// PUT /api/msbiz/admin/users/:id — update user permissions
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const perm = await requireMsbizPermission(req, "admin.users");
  if (perm instanceof NextResponse) return perm;
  const { uid } = perm;
  const { id } = await params;

  const { role_name, permissions } = await req.json();

  // Build merged permissions if role provided
  let finalPermissions = permissions;
  if (role_name && !permissions) {
    finalPermissions = MSBIZ_ROLE_PERMISSIONS[role_name] ?? MSBIZ_ROLE_PERMISSIONS.viewer;
  } else if (role_name && permissions) {
    finalPermissions = { ...(MSBIZ_ROLE_PERMISSIONS[role_name] ?? {}), ...permissions };
  }

  await profQuery(
    `UPDATE user_module_permissions
     SET role_name = COALESCE($1, role_name),
         permissions = COALESCE($2, permissions),
         granted_by = $3,
         updated_at = now()
     WHERE user_id = $4 AND module = 'msbiz'`,
    [role_name ?? null, finalPermissions ? JSON.stringify(finalPermissions) : null, uid, id]
  );

  return NextResponse.json({ ok: true });
}

// DELETE /api/msbiz/admin/users/:id — revoke module access
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const perm = await requireMsbizPermission(req, "admin.users");
  if (perm instanceof NextResponse) return perm;
  const { id } = await params;

  await profQuery(
    `DELETE FROM user_module_permissions WHERE user_id = $1 AND module = 'msbiz'`, [id]
  );
  await profQuery(
    `UPDATE "UserModule" SET enabled = false WHERE user_id = $1 AND module = 'msbiz'`, [id]
  );
  return NextResponse.json({ ok: true });
}
