import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

// GET /api/msbiz/admin/users — list all msbiz module users with permissions
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const perm = await requireMsbizPermission(req, "admin.users");
  if (perm instanceof NextResponse) return perm;

  const users = await profQuery(
    `SELECT u.id, u.email, u.name,
            p.role_name, p.permissions, p.granted_by, p.created_at AS access_granted_at
     FROM "User" u
     JOIN user_module_permissions p ON p.user_id = u.id AND p.module = 'msbiz'
     ORDER BY p.created_at DESC`
  );
  return NextResponse.json({ users });
}
