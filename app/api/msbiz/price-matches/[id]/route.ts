import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "price_match.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;

  const rows = await profQuery(
    `SELECT pm.*, o.ms_order_number FROM msbiz_price_matches pm
     LEFT JOIN msbiz_orders o ON o.id = pm.order_id
     WHERE pm.id = $1 AND pm.user_id = $2`, [id, uid]
  );
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ price_match: rows[0] });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "price_match.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;
  const body = await req.json();

  const editable = ["product_name","sku","original_price","match_price","match_source","match_source_url","status","submitted_at","approved_at","expires_at","notes"];
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const f of editable) {
    if (body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(body[f]); }
  }
  // Auto-set submitted_at when status changes to submitted
  if (body.status === "submitted" && !body.submitted_at) {
    updates.push(`submitted_at = now()`);
  }
  if (!updates.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  updates.push(`updated_at = now()`);
  values.push(id, uid);
  await profQuery(`UPDATE msbiz_price_matches SET ${updates.join(", ")} WHERE id = $${idx} AND user_id = $${idx+1}`, values);

  // Also update order pm_status if needed
  if (body.status) {
    const pmRows = await profQuery<{ order_id: string }>(`SELECT order_id FROM msbiz_price_matches WHERE id = $1`, [id]);
    if (pmRows[0]) {
      await profQuery(
        `UPDATE msbiz_orders SET pm_status = $1, updated_at = now() WHERE id = $2 AND user_id = $3`,
        [body.status, pmRows[0].order_id, uid]
      );
    }
  }
  return NextResponse.json({ ok: true });
}
