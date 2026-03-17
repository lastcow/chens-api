import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const uid      = req.headers.get("x-user-id") ?? "";
  const roleHeader = req.headers.get("x-user-role");

  // System ADMINs have all permissions
  if (roleHeader === "ADMIN") {
    return NextResponse.json({ permissions: ["*"], isAdmin: true });
  }

  const rows = await profQuery<{ permissions: string[] }>(
    `SELECT permissions FROM user_module_permissions WHERE user_id = $1 AND module = 'msbiz' LIMIT 1`,
    [uid]
  );

  const permissions: string[] = rows[0]?.permissions ?? [];
  return NextResponse.json({ permissions });
}
