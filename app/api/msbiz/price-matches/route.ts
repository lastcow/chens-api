import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "price_match.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const p = req.nextUrl.searchParams;
  const status = p.get("status");
  const urgent_only = p.get("urgent_only") === "true"; // expires within 3 days
  const order_id = p.get("order_id");

  const conditions = [`pm.user_id = $1`];
  const values: unknown[] = [uid];
  let idx = 2;
  if (status)      { conditions.push(`pm.status = $${idx++}`);    values.push(status); }
  if (order_id)    { conditions.push(`pm.order_id = $${idx++}`);  values.push(order_id); }
  if (urgent_only) { conditions.push(`pm.expires_at <= now() + INTERVAL '3 days' AND pm.status = 'pending'`); }

  const pms = await profQuery(
    `SELECT pm.*, o.ms_order_number, o.order_date
     FROM msbiz_price_matches pm
     LEFT JOIN msbiz_orders o ON o.id = pm.order_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY pm.expires_at ASC NULLS LAST, pm.created_at DESC`,
    values
  );
  return NextResponse.json({ price_matches: pms });
}

export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "price_match.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const { order_id, order_item_ref, product_name, sku, original_price, match_price, match_source, match_source_url, expires_at, notes } = await req.json();
  if (!order_id || !product_name || !original_price || !match_price) {
    return NextResponse.json({ error: "order_id, product_name, original_price, match_price required" }, { status: 400 });
  }

  // Calculate PM expiry from order date + pm_window_days (default 60 days)
  // This reflects order eligibility (e.g. 60 days from purchase), not PM submission date
  let finalExpiry = expires_at ?? null;
  if (!finalExpiry) {
    const ruleRows = await profQuery<{ pm_window_days: number }>(
      `SELECT pm_window_days FROM msbiz_pm_rules WHERE user_id = $1`, [uid]
    );
    const pmWindow = ruleRows[0]?.pm_window_days ?? 60; // default 60 days from order
    const orderRows = await profQuery<{ order_date: string; pm_deadline_at: string | null }>(
      `SELECT order_date, pm_deadline_at FROM msbiz_orders WHERE id = $1 AND user_id = $2`, [order_id, uid]
    );
    if (orderRows[0]) {
      // Use existing pm_deadline_at on order if set, otherwise calculate from order_date + window
      if (orderRows[0].pm_deadline_at) {
        finalExpiry = orderRows[0].pm_deadline_at;
      } else {
        const orderDate = new Date(orderRows[0].order_date);
        orderDate.setDate(orderDate.getDate() + pmWindow);
        finalExpiry = orderDate.toISOString();
        // Also stamp pm_deadline_at on the order for future reference
        await profQuery(
          `UPDATE msbiz_orders SET pm_deadline_at = $1, updated_at = now() WHERE id = $2 AND user_id = $3`,
          [finalExpiry, order_id, uid]
        );
      }
    }
  }

  // Check order is still eligible (not past window)
  if (finalExpiry && new Date(finalExpiry) < new Date()) {
    return NextResponse.json(
      { error: "Order is no longer eligible for price match — the PM window has expired" },
      { status: 400 }
    );
  }

  const rows = await profQuery(
    `INSERT INTO msbiz_price_matches (user_id, order_id, order_item_ref, product_name, sku, original_price, match_price, match_source, match_source_url, expires_at, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [uid, order_id, order_item_ref ?? null, product_name, sku ?? null, original_price, match_price, match_source ?? null, match_source_url ?? null, finalExpiry, notes ?? null]
  );
  return NextResponse.json({ price_match: rows[0] }, { status: 201 });
}
