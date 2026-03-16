import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "inbound.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const status = req.nextUrl.searchParams.get("status");
  const warehouse_id = req.nextUrl.searchParams.get("warehouse_id");

  const conditions = [`i.user_id = $1`];
  const values: unknown[] = [uid];
  let idx = 2;
  if (status)       { conditions.push(`i.status = $${idx++}`);       values.push(status); }
  if (warehouse_id) { conditions.push(`i.warehouse_id = $${idx++}`); values.push(warehouse_id); }

  const inbound = await profQuery(
    `SELECT i.*, o.ms_order_number, w.name AS warehouse_name
     FROM msbiz_inbound i
     LEFT JOIN msbiz_orders o ON o.id = i.order_id
     LEFT JOIN msbiz_warehouses w ON w.id = i.warehouse_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY i.created_at DESC`,
    values
  );
  return NextResponse.json({ inbound });
}

export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "inbound.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const { order_id, warehouse_id, sku, product_name, qty_expected, tracking_number, carrier, expected_at, notes } = await req.json();
  if (!order_id || !warehouse_id || !sku || !product_name || !qty_expected) {
    return NextResponse.json({ error: "order_id, warehouse_id, sku, product_name, qty_expected required" }, { status: 400 });
  }

  const rows = await profQuery(
    `INSERT INTO msbiz_inbound (user_id, order_id, warehouse_id, sku, product_name, qty_expected, tracking_number, carrier, expected_at, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [uid, order_id, warehouse_id, sku, product_name, qty_expected, tracking_number ?? null, carrier ?? null, expected_at ?? null, notes ?? null]
  );
  return NextResponse.json({ inbound: rows[0] }, { status: 201 });
}
