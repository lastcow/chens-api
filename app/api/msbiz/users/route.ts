import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

// GET /api/msbiz/users?role=pmer — list msbiz users by role
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "orders.view");
  if (result instanceof NextResponse) return result;

  const role = req.nextUrl.searchParams.get("role") ?? "";

  const users = await profQuery<{ id: string; name: string | null; email: string }>(
    `SELECT u.id, u.name, u.email
     FROM "User" u
     JOIN user_module_permissions p ON p.user_id = u.id AND p.module = 'msbiz'
     WHERE (u.suspended IS NULL OR u.suspended = false)
     ${role ? `AND p.role_name = '${role.replace(/[^a-z]/g, "")}'` : ""}
     ORDER BY u.name ASC, u.email ASC`
  );
  return NextResponse.json({ users });
}
