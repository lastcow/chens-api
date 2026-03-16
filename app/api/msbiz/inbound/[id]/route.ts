import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "inbound.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;

  const rows = await profQuery(
    `SELECT i.*, o.ms_order_number, w.name AS warehouse_name
     FROM msbiz_inbound i
     LEFT JOIN msbiz_orders o ON o.id = i.order_id
     LEFT JOIN msbiz_warehouses w ON w.id = i.warehouse_id
     WHERE i.id = $1 AND i.user_id = $2`,
    [id, uid]
  );
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ inbound: rows[0] });
}

// PUT — receive items, update qty_received, auto-update inventory
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "inbound.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;
  const { qty_received, status, tracking_number, carrier, received_at, notes } = await req.json();

  // Get current inbound record
  const rows = await profQuery<{ warehouse_id: string; sku: string; product_name: string; qty_received: number }>(
    `SELECT warehouse_id, sku, product_name, qty_received FROM msbiz_inbound WHERE id = $1 AND user_id = $2`,
    [id, uid]
  );
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const current = rows[0];

  // Calculate inventory delta
  const prevQty = current.qty_received ?? 0;
  const newQty = qty_received ?? prevQty;
  const delta = newQty - prevQty;

  // Update inbound record
  await profQuery(
    `UPDATE msbiz_inbound SET
       qty_received = COALESCE($1, qty_received),
       status = COALESCE($2, status),
       tracking_number = COALESCE($3, tracking_number),
       carrier = COALESCE($4, carrier),
       received_at = COALESCE($5, received_at),
       notes = COALESCE($6, notes),
       updated_at = now()
     WHERE id = $7 AND user_id = $8`,
    [qty_received ?? null, status ?? null, tracking_number ?? null, carrier ?? null, received_at ?? null, notes ?? null, id, uid]
  );

  // Update inventory if qty changed
  if (delta !== 0) {
    await profQuery(
      `INSERT INTO msbiz_inventory (warehouse_id, sku, product_name, qty_on_hand)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (warehouse_id, sku)
       DO UPDATE SET qty_on_hand = msbiz_inventory.qty_on_hand + $4, updated_at = now()`,
      [current.warehouse_id, current.sku, current.product_name, delta]
    );
  }

  return NextResponse.json({ ok: true });
}
