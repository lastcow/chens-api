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

  const permJson = finalPermissions ? JSON.stringify(finalPermissions) : null;
  const resolvedRole = role_name ?? "operator";

  await profQuery(
    `INSERT INTO user_module_permissions (user_id, module, role_name, permissions, granted_by)
     VALUES ($1, 'msbiz', $2, COALESCE($3, '{}'), $4)
     ON CONFLICT (user_id, module)
     DO UPDATE SET
       role_name   = COALESCE($2, user_module_permissions.role_name),
       permissions = COALESCE($3::jsonb, user_module_permissions.permissions),
       granted_by  = $4,
       updated_at  = now()`,
    [id, resolvedRole, permJson, uid]
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
