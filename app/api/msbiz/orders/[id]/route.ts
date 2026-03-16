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

  const [orderRows, pmRows, inboundRows, exceptionsRows] = await Promise.all([
    profQuery(
      `SELECT o.*, a.email AS account_email, a.display_name AS account_name,
              addr.full_address AS shipping_address
       FROM msbiz_orders o
       LEFT JOIN msbiz_accounts a ON a.id = o.account_id
       LEFT JOIN msbiz_addresses addr ON addr.id = o.shipping_address_id
       WHERE o.id = $1 AND o.user_id = $2`,
      [id, uid]
    ),
    profQuery(`SELECT * FROM msbiz_price_matches WHERE order_id = $1 ORDER BY expires_at ASC`, [id]),
    profQuery(`SELECT * FROM msbiz_inbound WHERE order_id = $1 ORDER BY created_at DESC`, [id]),
    profQuery(`SELECT * FROM msbiz_exceptions WHERE ref_id = $1 AND ref_type = 'order' ORDER BY created_at DESC`, [id]),
  ]);

  if (!orderRows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ order: orderRows[0], price_matches: pmRows, inbound: inboundRows, exceptions: exceptionsRows });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "orders.edit");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;
  const body = await req.json();

  const editable = ["account_id","ms_order_number","order_date","status","items","subtotal","tax","shipping_cost","total","shipping_address_id","tracking_number","carrier","pm_status","pm_deadline_at","pm_amount","pm_submitted_at","inbound_status","notes"];
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const f of editable) {
    if (body[f] !== undefined) {
      updates.push(`${f} = $${idx++}`);
      values.push(f === "items" ? JSON.stringify(body[f]) : body[f]);
    }
  }
  if (!updates.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  updates.push(`updated_at = now()`);
  values.push(id, uid);
  await profQuery(`UPDATE msbiz_orders SET ${updates.join(", ")} WHERE id = $${idx} AND user_id = $${idx+1}`, values);
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
