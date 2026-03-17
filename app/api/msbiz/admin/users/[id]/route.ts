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

  const resolvedRole = role_name ?? "operator";

  if (finalPermissions) {
    // Always pass as text and cast via to_json to avoid neon jsonb binding issues
    await profQuery(
      `INSERT INTO user_module_permissions (user_id, module, role_name, permissions, granted_by)
       VALUES ($1, 'msbiz', $2, $3, $4)
       ON CONFLICT (user_id, module)
       DO UPDATE SET
         role_name   = $2,
         permissions = $3,
         granted_by  = $4,
         updated_at  = now()`,
      [id, resolvedRole, finalPermissions, uid]
    );
  } else {
    // Just update role, keep existing permissions
    await profQuery(
      `INSERT INTO user_module_permissions (user_id, module, role_name, permissions, granted_by)
       VALUES ($1, 'msbiz', $2, '{}', $3)
       ON CONFLICT (user_id, module)
       DO UPDATE SET role_name = $2, granted_by = $3, updated_at = now()`,
      [id, resolvedRole, uid]
    );
  }

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
