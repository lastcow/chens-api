import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";
import { discordAlert } from "@/lib/discord-alert";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authErr = requireApiKey(req);
    if (authErr) return authErr;
    const result = await requireMsbizPermission(req, "price_match.view");
    if (result instanceof NextResponse) return result;
    const { uid } = result;
    const { id } = await params;

    const rows = await profQuery(
      `SELECT pm.*,
              s.value AS status_value, s.label AS status_label, s.color_hex AS status_color,
              o.ms_order_number, o.order_date,
              a.email AS account_email, a.display_name AS account_name,
              (SELECT json_agg(json_build_object('name', oi.name, 'qty', oi.qty, 'unit_price', oi.unit_price))
               FROM msbiz_order_items oi WHERE oi.order_id = pm.order_id) AS items
       FROM msbiz_price_matches pm
       LEFT JOIN msbiz_statuses s ON s.id = pm.status
       LEFT JOIN msbiz_orders o ON o.id = pm.order_id
       LEFT JOIN msbiz_accounts a ON a.id = o.account_id
       WHERE pm.id = $1 AND pm.user_id = $2`,
      [id, uid]
    );
    if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ price_match: rows[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await discordAlert({ title: "PM GET [id] Error", message: msg, path: "/api/msbiz/price-matches/[id]" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authErr = requireApiKey(req);
    if (authErr) return authErr;
    const result = await requireMsbizPermission(req, "price_match.manage");
    if (result instanceof NextResponse) return result;
    const { uid } = result;
    const { id } = await params;

    const { refund_amount, refund_type, notes, rewarded_to } = await req.json();
    if (!refund_amount || !refund_type) {
      return NextResponse.json({ error: "refund_amount and refund_type are required" }, { status: 400 });
    }
    if (refund_type !== "full" && refund_type !== "partial") {
      return NextResponse.json({ error: "refund_type must be 'full' or 'partial'" }, { status: 400 });
    }

    // Calculate reward
    const fullRate = parseFloat(process.env.PM_FULL_REFUND_AWARD ?? "0.15");
    const partialRate = parseFloat(process.env.PM_PARTIAL_REFUND_AWARD ?? "0.10");
    const rate = refund_type === "full" ? fullRate : partialRate;
    const reward_amount = parseFloat((Number(refund_amount) * rate).toFixed(2));

    // Verify PM exists and belongs to user
    const pmRows = await profQuery<{ order_id: string }>(
      `SELECT order_id FROM msbiz_price_matches WHERE id = $1 AND user_id = $2`,
      [id, uid]
    );
    if (!pmRows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { order_id } = pmRows[0];

    // Update msbiz_price_matches
    await profQuery(
      `UPDATE msbiz_price_matches
       SET refund_amount = $1, refund_type = $2, reward_amount = $3,
           rewarded_to = $4, rewarded_at = now(), notes = COALESCE($5, notes),
           status = 'price_match.approved', updated_at = now()
       WHERE id = $6 AND user_id = $7`,
      [refund_amount, refund_type, reward_amount, rewarded_to ?? null, notes ?? null, id, uid]
    );

    // Update order pm_status
    await profQuery(
      `UPDATE msbiz_orders SET pm_status = 'price_match.approved', updated_at = now() WHERE id = $1 AND user_id = $2`,
      [order_id, uid]
    );

    // Insert into msbiz_pm_rewards
    await profQuery(
      `INSERT INTO msbiz_pm_rewards (pm_id, user_id, order_id, refund_amount, refund_type, reward_amount, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, rewarded_to ?? uid, order_id, refund_amount, refund_type, reward_amount, notes ?? null]
    );

    // Return updated PM
    const updated = await profQuery(
      `SELECT pm.*,
              s.value AS status_value, s.label AS status_label, s.color_hex AS status_color,
              o.ms_order_number, o.order_date,
              a.email AS account_email, a.display_name AS account_name,
              (SELECT json_agg(json_build_object('name', oi.name, 'qty', oi.qty, 'unit_price', oi.unit_price))
               FROM msbiz_order_items oi WHERE oi.order_id = pm.order_id) AS items
       FROM msbiz_price_matches pm
       LEFT JOIN msbiz_statuses s ON s.id = pm.status
       LEFT JOIN msbiz_orders o ON o.id = pm.order_id
       LEFT JOIN msbiz_accounts a ON a.id = o.account_id
       WHERE pm.id = $1`,
      [id]
    );

    return NextResponse.json({ price_match: updated[0], reward_amount });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await discordAlert({ title: "PM PATCH Error", message: msg, path: "/api/msbiz/price-matches/[id]" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
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
  if (body.status === "submitted" && !body.submitted_at) {
    updates.push(`submitted_at = now()`);
  }
  if (!updates.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  updates.push(`updated_at = now()`);
  values.push(id, uid);
  await profQuery(`UPDATE msbiz_price_matches SET ${updates.join(", ")} WHERE id = $${idx} AND user_id = $${idx+1}`, values);

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
