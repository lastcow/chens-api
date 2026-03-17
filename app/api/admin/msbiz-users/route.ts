import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, requireAdmin } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

// GET /api/admin/msbiz-users — list all users with msbiz module access
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;

  const users = await profQuery(
    `SELECT u.id, u.email, u.name, p.role_name
     FROM "User" u
     JOIN user_module_permissions p ON p.user_id = u.id AND p.module = 'msbiz'
     WHERE (u.suspended IS NULL OR u.suspended = false)
     ORDER BY u.name ASC, u.email ASC`
  );
  return NextResponse.json({ users });
}
