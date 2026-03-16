import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "warehouse.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;

  const [warehouseRows, inventoryRows] = await Promise.all([
    profQuery(
      `SELECT w.*, a.full_address AS address_text FROM msbiz_warehouses w
       LEFT JOIN msbiz_addresses a ON a.id = w.address_id
       WHERE w.id = $1 AND w.user_id = $2`,
      [id, uid]
    ),
    profQuery(
      `SELECT * FROM msbiz_inventory WHERE warehouse_id = $1 ORDER BY product_name`,
      [id]
    ),
  ]);
  if (!warehouseRows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ warehouse: warehouseRows[0], inventory: inventoryRows });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "warehouse.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;
  const body = await req.json();

  const fields = ["name","address_id","owner_name","owner_contact","inbound_cost_per_unit","outbound_cost_per_unit","notes","active"];
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const f of fields) {
    if (body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(body[f]); }
  }
  if (!updates.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  updates.push(`updated_at = now()`);
  values.push(id, uid);
  await profQuery(`UPDATE msbiz_warehouses SET ${updates.join(", ")} WHERE id = $${idx} AND user_id = $${idx+1}`, values);
  return NextResponse.json({ ok: true });
}
