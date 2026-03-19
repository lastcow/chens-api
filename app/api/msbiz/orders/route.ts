import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

// GET /api/msbiz/orders
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "orders.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const p = req.nextUrl.searchParams;
  const status = p.get("status");
  const pm_status = p.get("pm_status");
  const account_id = p.get("account_id");
  const search = p.get("search");
  const page = Math.max(1, parseInt(p.get("page") ?? "1"));
  const limit = Math.min(100, parseInt(p.get("limit") ?? "25"));
  const offset = (page - 1) * limit;

  const conditions = [`o.user_id = $1`];
  const values: unknown[] = [uid];
  let idx = 2;

  if (status)     { conditions.push(`o.status = $${idx++}`);     values.push(status); }
  if (pm_status)  { conditions.push(`o.pm_status = $${idx++}`);  values.push(pm_status); }
  if (account_id) { conditions.push(`o.account_id = $${idx++}`); values.push(account_id); }
  if (search)     { conditions.push(`o.ms_order_number ILIKE $${idx++}`); values.push(`%${search}%`); }

  const where = conditions.join(" AND ");

  const [orders, countRows] = await Promise.all([
    profQuery(
      `SELECT o.*,
              (SELECT COUNT(*) FROM msbiz_exceptions e WHERE e.ref_id = o.id AND e.ref_type = 'order')::int AS exception_count,
              s.tracking_number, s.carrier, s.inbound_status,
              a.email AS account_email, a.display_name AS account_name
       FROM msbiz_orders o
       LEFT JOIN msbiz_accounts a ON a.id = o.account_id
       LEFT JOIN msbiz_order_shipping s ON s.order_id = o.id
       WHERE ${where}
       ORDER BY o.order_date DESC, o.created_at DESC
       LIMIT $${idx} OFFSET $${idx+1}`,
      [...values, limit, offset]
    ),
    profQuery(`SELECT COUNT(*) AS total FROM msbiz_orders o WHERE ${where}`, values),
  ]);

  return NextResponse.json({
    orders,
    total: parseInt(String(countRows[0]?.total ?? 0)),
    page,
    limit,
  });
}

// POST /api/msbiz/orders
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "orders.create");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const { account_id, ms_order_number, order_date, items = [], subtotal = 0, tax = 0, shipping_cost = 0, total = 0, shipping_address_id, tracking_number, carrier, pm_deadline_at, notes } = await req.json();
  if (!account_id || !ms_order_number || !order_date) {
    return NextResponse.json({ error: "account_id, ms_order_number, and order_date are required" }, { status: 400 });
  }

  const rows = await profQuery(
    `INSERT INTO msbiz_orders
       (user_id, account_id, ms_order_number, order_date, items, subtotal, tax, shipping_cost, total, shipping_address_id, pm_deadline_at, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [uid, account_id, ms_order_number, order_date, JSON.stringify(items), subtotal, tax, shipping_cost, total, shipping_address_id ?? null, pm_deadline_at ?? null, notes ?? null]
  );
  // Insert shipping record if tracking info provided
  if (tracking_number) {
    await profQuery(
      `INSERT INTO msbiz_order_shipping (order_id, tracking_number, carrier, inbound_status)
       VALUES ($1, $2, $3, 'ordered')
       ON CONFLICT (order_id) DO UPDATE SET tracking_number = EXCLUDED.tracking_number, carrier = EXCLUDED.carrier, updated_at = now()`,
      [rows[0].id, tracking_number, carrier ?? null]
    );
  }
  return NextResponse.json({ order: rows[0] }, { status: 201 });
}
