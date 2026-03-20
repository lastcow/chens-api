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
               FROM msbiz_order_items oi
               WHERE oi.order_id = pm.order_id) AS items,
              pu.name AS pmer_name, pu.email AS pmer_email,
              r.refund_amount, r.refund_type, r.reward_amount, r.rewarded_to, r.created_at AS rewarded_at
       FROM msbiz_price_matches pm
       LEFT JOIN msbiz_statuses s ON s.id = pm.status
       LEFT JOIN msbiz_orders o ON o.id = pm.order_id
       LEFT JOIN msbiz_accounts a ON a.id = o.account_id
       LEFT JOIN "User" pu ON pu.id = pm.assigned_pmer_id
       LEFT JOIN msbiz_pm_rewards r ON r.pm_id = pm.id
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

    const { refund_amount, notes } = await req.json();
    if (!refund_amount) {
      return NextResponse.json({ error: "refund_amount is required" }, { status: 400 });
    }

    // Fetch original price to determine refund tier
    const origRows = await profQuery<{ original_price: string }>(
      `SELECT original_price FROM msbiz_price_matches WHERE id = $1`, [id]
    );
    const originalPrice = parseFloat(origRows[0]?.original_price ?? "0");
    const refundNum = Number(refund_amount);
    const refundRatio = originalPrice > 0 ? refundNum / originalPrice : 0;

    // 3-tier reward logic:
    // < 25% of original → partial (PM_PARTIAL_REFUND_AWARD)
    // 25–99% of original → partial_over (PM_PARTIAL_OVER_REFUND_AWARD)
    // 100% (full) → full (PM_FULL_REFUND_AWARD)
    const fullRate        = parseFloat(process.env.PM_FULL_REFUND_AWARD            ?? "0.15");
    const partialOverRate = parseFloat(process.env.PM_PARTIAL_OVER_REFUND_AWARD    ?? "0.12");
    const partialRate     = parseFloat(process.env.PM_PARTIAL_REFUND_AWARD         ?? "0.10");

    let refund_type: string;
    let rate: number;
    if (refundRatio >= 1.0) {
      refund_type = "full";
      rate = fullRate;
    } else if (refundRatio >= 0.25) {
      refund_type = "partial_over";
      rate = partialOverRate;
    } else {
      refund_type = "partial";
      rate = partialRate;
    }
    const reward_amount = parseFloat((refundNum * rate).toFixed(2));

    // Verify PM exists, belongs to user, get assigned pmer
    const pmRows = await profQuery<{ order_id: string; assigned_pmer_id: string | null }>(
      `SELECT order_id, assigned_pmer_id FROM msbiz_price_matches WHERE id = $1 AND user_id = $2`,
      [id, uid]
    );
    if (!pmRows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { order_id, assigned_pmer_id } = pmRows[0];
    // Reward always goes to the assigned pmer (not the professor submitting)
    const rewardRecipient = assigned_pmer_id ?? uid;

    // Update msbiz_price_matches — status + notes only (reward details live in msbiz_pm_rewards)
    await profQuery(
      `UPDATE msbiz_price_matches
       SET notes = COALESCE($1, notes), status = 'price_match.approved', updated_at = now()
       WHERE id = $2 AND user_id = $3`,
      [notes ?? null, id, uid]
    );

    // Update order pm_status
    await profQuery(
      `UPDATE msbiz_orders SET pm_status = 'price_match.approved', updated_at = now() WHERE id = $1 AND user_id = $2`,
      [order_id, uid]
    );

    // Insert reward — always to assigned pmer
    await profQuery(
      `INSERT INTO msbiz_pm_rewards (pm_id, user_id, rewarded_to, order_id, refund_amount, refund_type, reward_amount, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, uid, rewardRecipient, order_id, refund_amount, refund_type, reward_amount, notes ?? null]
    );

    // Return updated PM with reward data from msbiz_pm_rewards
    const updated = await profQuery(
      `SELECT pm.*,
              s.value AS status_value, s.label AS status_label, s.color_hex AS status_color,
              o.ms_order_number, o.order_date,
              a.email AS account_email, a.display_name AS account_name,
              (SELECT json_agg(json_build_object('name', oi.name, 'qty', oi.qty, 'unit_price', oi.unit_price))
               FROM msbiz_order_items oi
               WHERE oi.order_id = pm.order_id) AS items,
              pu.name AS pmer_name, pu.email AS pmer_email,
              r.refund_amount, r.refund_type, r.reward_amount, r.rewarded_to, r.created_at AS rewarded_at
       FROM msbiz_price_matches pm
       LEFT JOIN msbiz_statuses s ON s.id = pm.status
       LEFT JOIN msbiz_orders o ON o.id = pm.order_id
       LEFT JOIN msbiz_accounts a ON a.id = o.account_id
       LEFT JOIN "User" pu ON pu.id = pm.assigned_pmer_id
       LEFT JOIN msbiz_pm_rewards r ON r.pm_id = pm.id
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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authErr = requireApiKey(req);
    if (authErr) return authErr;
    const result = await requireMsbizPermission(req, "price_match.manage");
    if (result instanceof NextResponse) return result;
    const { uid } = result;
    const { id } = await params;

    // Get order_id before deleting
    const pmRows = await profQuery<{ order_id: string }>(
      `SELECT order_id FROM msbiz_price_matches WHERE id = $1 AND user_id = $2`,
      [id, uid]
    );
    if (!pmRows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { order_id } = pmRows[0];

    // Delete PM record (cascades to msbiz_pm_rewards)
    await profQuery(`DELETE FROM msbiz_price_matches WHERE id = $1 AND user_id = $2`, [id, uid]);

    // Check if any PM records remain for this order
    const remaining = await profQuery<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM msbiz_price_matches WHERE order_id = $1 AND user_id = $2`,
      [order_id, uid]
    );
    // If no PM records left, reset order pm_status to unpmed
    if (parseInt(remaining[0].cnt) === 0) {
      await profQuery(
        `UPDATE msbiz_orders SET pm_status = 'pm.unpmed', updated_at = now() WHERE id = $1 AND user_id = $2`,
        [order_id, uid]
      );
    }

    return NextResponse.json({ ok: true, order_id, pm_reset: parseInt(remaining[0].cnt) === 0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await discordAlert({ title: "PM DELETE Error", message: msg, path: "/api/msbiz/price-matches/[id]" });
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
