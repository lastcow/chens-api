import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "outbound.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const status = req.nextUrl.searchParams.get("status");
  const warehouse_id = req.nextUrl.searchParams.get("warehouse_id");
  const conditions = [`o.user_id = $1`];
  const values: unknown[] = [uid];
  let idx = 2;
  if (status)       { conditions.push(`o.status = $${idx++}`);       values.push(status); }
  if (warehouse_id) { conditions.push(`o.warehouse_id = $${idx++}`); values.push(warehouse_id); }

  const outbound = await profQuery(
    `SELECT o.*, w.name AS warehouse_name, a.full_address AS destination_address
     FROM msbiz_outbound o
     LEFT JOIN msbiz_warehouses w ON w.id = o.warehouse_id
     LEFT JOIN msbiz_addresses a ON a.id = o.destination_address_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY o.created_at DESC`,
    values
  );
  return NextResponse.json({ outbound });
}

export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "outbound.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const { warehouse_id, destination_type = "customer", destination_address_id, items = [], tracking_number, carrier, per_item_cost, shipping_cost, notes } = await req.json();
  if (!warehouse_id) return NextResponse.json({ error: "warehouse_id required" }, { status: 400 });

  const qty_total = (items as { qty: number }[]).reduce((s, i) => s + (i.qty || 0), 0);
  const total_warehouse_cost = qty_total * (per_item_cost ?? 0);

  const rows = await profQuery(
    `INSERT INTO msbiz_outbound (user_id, warehouse_id, destination_type, destination_address_id, tracking_number, carrier, items, qty_total, per_item_cost, total_warehouse_cost, shipping_cost, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [uid, warehouse_id, destination_type, destination_address_id ?? null, tracking_number ?? null, carrier ?? null, JSON.stringify(items), qty_total, per_item_cost ?? 0, total_warehouse_cost, shipping_cost ?? 0, notes ?? null]
  );

  // Deduct from inventory
  for (const item of items as { sku: string; qty: number }[]) {
    if (item.sku && item.qty) {
      await profQuery(
        `UPDATE msbiz_inventory SET qty_on_hand = qty_on_hand - $1, updated_at = now()
         WHERE warehouse_id = $2 AND sku = $3`,
        [item.qty, warehouse_id, item.sku]
      );
    }
  }

  return NextResponse.json({ outbound: rows[0] }, { status: 201 });
}
