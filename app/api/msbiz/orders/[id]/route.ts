import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "orders.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;

  const [orderRows, itemRows, pmRows, inboundRows, exceptionsRows] = await Promise.all([
    profQuery(
      `SELECT o.*,
              (SELECT COUNT(*) FROM msbiz_exceptions e WHERE e.ref_id = o.id AND e.ref_type = 'order')::int AS exception_count,
              s.tracking_number, s.carrier, s.inbound_status,
              a.email AS account_email, a.display_name AS account_name,
              addr.full_address AS shipping_address
       FROM msbiz_orders o
       LEFT JOIN msbiz_accounts a ON a.id = o.account_id
       LEFT JOIN msbiz_addresses addr ON addr.id = o.shipping_address_id
       LEFT JOIN msbiz_order_shipping s ON s.order_id = o.id
       WHERE o.id = $1 AND o.user_id = $2`,
      [id, uid]
    ),
    profQuery(`SELECT * FROM msbiz_order_items WHERE order_id = $1 ORDER BY created_at ASC`, [id]),
    profQuery(`SELECT * FROM msbiz_price_matches WHERE order_id = $1 ORDER BY expires_at ASC`, [id]),
    profQuery(`SELECT * FROM msbiz_inbound WHERE order_id = $1 ORDER BY created_at DESC`, [id]),
    profQuery(`SELECT * FROM msbiz_exceptions WHERE ref_id = $1 AND ref_type = 'order' ORDER BY created_at DESC`, [id]),
  ]);

  if (!orderRows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    order: { ...(orderRows[0] as Record<string, unknown>), items: itemRows },
    price_matches: pmRows,
    inbound: inboundRows,
    exceptions: exceptionsRows,
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "orders.edit");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;
  const body = await req.json();

  // items handled separately via msbiz_order_items table
  const editable = ["account_id","ms_order_number","order_date","status","subtotal","tax","shipping_cost","total","shipping_address_id","pm_status","pm_deadline_at","pm_amount","pm_submitted_at","notes"];
  const shippingEditable = ["tracking_number","carrier","inbound_status"];
  // Auto-stamp pm_submitted_at when pm_status transitions to submitted
  if (body.pm_status === "submitted" && !body.pm_submitted_at) {
    body.pm_submitted_at = new Date().toISOString();
  }
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const f of editable) {
    if (body[f] !== undefined) {
      updates.push(`${f} = $${idx++}`);
      values.push(body[f]);
    }
  }
  // Update shipping table for shipping fields
  const shippingUpdates: string[] = [];
  const shippingValues: unknown[] = [];
  let sidx = 1;
  for (const f of shippingEditable) {
    if (body[f] !== undefined) {
      shippingUpdates.push(`${f} = $${sidx++}`);
      shippingValues.push(body[f]);
    }
  }

  // Handle items update if provided
  if (Array.isArray(body.items)) {
    await profQuery(`DELETE FROM msbiz_order_items WHERE order_id = $1`, [id]);
    for (const item of body.items as { merchandise_id?: string; name: string; qty?: number; unit_price?: number }[]) {
      if (!item.name) continue;
      await profQuery(
        `INSERT INTO msbiz_order_items (order_id, merchandise_id, name, qty, unit_price)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, item.merchandise_id ?? null, item.name, item.qty ?? 1, item.unit_price ?? 0]
      );
    }
  }

  if (!updates.length && !shippingUpdates.length && !Array.isArray(body.items)) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  if (updates.length) {
    updates.push(`updated_at = now()`);
    values.push(id, uid);
    await profQuery(`UPDATE msbiz_orders SET ${updates.join(", ")} WHERE id = $${idx} AND user_id = $${idx+1}`, values);
  }
  if (shippingUpdates.length) {
    shippingUpdates.push(`updated_at = now()`);
    shippingValues.push(id);
    // Build upsert: ensure row exists then update
    await profQuery(
      `INSERT INTO msbiz_order_shipping (order_id) VALUES ($${shippingValues.length})
       ON CONFLICT (order_id) DO NOTHING`,
      [id]
    );
    await profQuery(
      `UPDATE msbiz_order_shipping SET ${shippingUpdates.join(", ")} WHERE order_id = $${shippingValues.length}`,
      shippingValues
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "orders.delete");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;
  await profQuery(`DELETE FROM msbiz_orders WHERE id = $1 AND user_id = $2`, [id, uid]);
  return NextResponse.json({ ok: true });
}
