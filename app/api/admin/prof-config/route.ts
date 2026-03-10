import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, requireAdmin } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

// GET /api/admin/prof-config — list all config keys
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;

  const rows = await profQuery<{ key: string; value: string; label: string }>(
    `SELECT key, value, label FROM prof_config ORDER BY key`, []
  );
  return NextResponse.json({ config: rows });
}

// PATCH /api/admin/prof-config — update a config key
export async function PATCH(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;

  const { key, value } = await req.json();
  if (!key || value === undefined) {
    return NextResponse.json({ error: "Missing key or value" }, { status: 400 });
  }

  await profQuery(
    `UPDATE prof_config SET value = $1, updated_at = now() WHERE key = $2`,
    [String(value), key]
  );

  return NextResponse.json({ ok: true, key, value });
}
