import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "orders.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const [orderStats, pmStats, exceptionStats, reminderStats, inventoryStats] = await Promise.all([
    // Order counts by status
    profQuery(
      `SELECT status, COUNT(*) AS count FROM msbiz_orders WHERE user_id = $1 GROUP BY status`,
      [uid]
    ),
    // PM urgency
    profQuery(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending') AS total_pending,
         COUNT(*) FILTER (WHERE status = 'pending' AND expires_at <= now() + INTERVAL '3 days') AS urgent,
         COUNT(*) FILTER (WHERE status = 'pending' AND expires_at < now()) AS expired,
         COALESCE(SUM(original_price - match_price) FILTER (WHERE status = 'approved'), 0) AS total_savings
       FROM msbiz_price_matches WHERE user_id = $1`,
      [uid]
    ),
    // Open exceptions by severity
    profQuery(
      `SELECT severity, COUNT(*) AS count FROM msbiz_exceptions
       WHERE user_id = $1 AND status IN ('open', 'in_progress') GROUP BY severity`,
      [uid]
    ),
    // Pending reminders due soon
    profQuery(
      `SELECT COUNT(*) AS count FROM msbiz_reminders
       WHERE user_id = $1 AND status = 'pending' AND remind_at <= now() + INTERVAL '24 hours'`,
      [uid]
    ),
    // Inventory value
    profQuery(
      `SELECT COUNT(*) AS sku_count, SUM(qty_on_hand) AS total_units
       FROM msbiz_inventory i
       JOIN msbiz_warehouses w ON w.id = i.warehouse_id
       WHERE w.user_id = $1`,
      [uid]
    ),
  ]);

  // Reshape order stats
  const orders: Record<string, number> = {};
  for (const r of orderStats as { status: string; count: string }[]) {
    orders[r.status] = parseInt(r.count);
  }

  return NextResponse.json({
    orders,
    orders_total: Object.values(orders).reduce((a, b) => a + b, 0),
    price_matches: pmStats[0] ?? {},
    exceptions: exceptionStats,
    reminders_due: parseInt(String((reminderStats[0] as { count: string })?.count ?? 0)),
    inventory: inventoryStats[0] ?? {},
  });
}
