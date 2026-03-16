import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

// GET /api/msbiz/costs/summary — monthly P&L breakdown
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "costs.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const months = parseInt(req.nextUrl.searchParams.get("months") ?? "6");

  const [monthlyCosts, pmSavings, invoiceTotals] = await Promise.all([
    // Monthly costs by type
    profQuery(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', paid_at), 'YYYY-MM') AS month,
         type,
         SUM(amount) AS total
       FROM msbiz_costs
       WHERE user_id = $1 AND paid_at >= now() - ($2 || ' months')::INTERVAL
       GROUP BY month, type ORDER BY month DESC, total DESC`,
      [uid, months]
    ),
    // Total PM savings
    profQuery(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', approved_at), 'YYYY-MM') AS month,
         SUM(original_price - match_price) AS savings,
         COUNT(*) AS count
       FROM msbiz_price_matches
       WHERE user_id = $1 AND status = 'approved' AND approved_at >= now() - ($2 || ' months')::INTERVAL
       GROUP BY month ORDER BY month DESC`,
      [uid, months]
    ),
    // Invoice revenue
    profQuery(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', paid_at), 'YYYY-MM') AS month,
         SUM(total) AS revenue,
         COUNT(*) AS invoices
       FROM msbiz_invoices
       WHERE user_id = $1 AND status = 'paid' AND paid_at >= now() - ($2 || ' months')::INTERVAL
       GROUP BY month ORDER BY month DESC`,
      [uid, months]
    ),
  ]);

  return NextResponse.json({ monthly_costs: monthlyCosts, pm_savings: pmSavings, invoice_revenue: invoiceTotals });
}
