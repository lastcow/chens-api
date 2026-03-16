import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "outbound.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;

  const rows = await profQuery(
    `SELECT o.*, w.name AS warehouse_name, a.full_address AS destination_address
     FROM msbiz_outbound o
     LEFT JOIN msbiz_warehouses w ON w.id = o.warehouse_id
     LEFT JOIN msbiz_addresses a ON a.id = o.destination_address_id
     WHERE o.id = $1 AND o.user_id = $2`,
    [id, uid]
  );
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ outbound: rows[0] });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "outbound.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;
  const body = await req.json();

  const editable = ["status","tracking_number","carrier","destination_address_id","shipped_at","delivered_at","notes"];
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const f of editable) {
    if (body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(body[f]); }
  }
  if (!updates.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  updates.push(`updated_at = now()`);
  values.push(id, uid);
  await profQuery(`UPDATE msbiz_outbound SET ${updates.join(", ")} WHERE id = $${idx} AND user_id = $${idx+1}`, values);
  return NextResponse.json({ ok: true });
}
