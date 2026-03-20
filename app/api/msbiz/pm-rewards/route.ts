import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";
import { discordAlert } from "@/lib/discord-alert";

export async function GET(req: NextRequest) {
  try {
    const authErr = requireApiKey(req);
    if (authErr) return authErr;
    const result = await requireMsbizPermission(req, "price_match.view");
    if (result instanceof NextResponse) return result;
    const { uid } = result;

    const p = req.nextUrl.searchParams;
    const user_id = p.get("user_id") ?? uid;
    const limit = parseInt(p.get("limit") ?? "50");
    const offset = parseInt(p.get("offset") ?? "0");

    const rewards = await profQuery(
      `SELECT r.*, pm.ms_order_number, o.ms_order_number as order_number
       FROM msbiz_pm_rewards r
       LEFT JOIN msbiz_price_matches pm ON pm.id = r.pm_id
       LEFT JOIN msbiz_orders o ON o.id = r.order_id
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [user_id, limit, offset]
    );

    const total = await profQuery<{ count: string }>(
      `SELECT COUNT(*) FROM msbiz_pm_rewards WHERE user_id = $1`, [user_id]
    );

    return NextResponse.json({
      rewards,
      total: parseInt(total[0]?.count ?? "0"),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await discordAlert({ title: "PM Rewards GET Error", message: msg, path: "/api/msbiz/pm-rewards" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
