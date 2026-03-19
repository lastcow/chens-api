import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

// GET /api/msbiz/orders/:id/shipping
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "orders.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;

  // Verify order belongs to user
  const order = await profQuery(`SELECT id FROM msbiz_orders WHERE id = $1 AND user_id = $2`, [id, uid]);
  if (!order[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await profQuery(
    `SELECT * FROM msbiz_order_shipping WHERE order_id = $1 ORDER BY created_at DESC`,
    [id]
  );
  return NextResponse.json({ shipping: rows });
}

// POST /api/msbiz/orders/:id/shipping — upsert (one shipping record per order)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "orders.create");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;

  const order = await profQuery(`SELECT id FROM msbiz_orders WHERE id = $1 AND user_id = $2`, [id, uid]);
  if (!order[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { tracking_number, carrier } = await req.json();
  if (!tracking_number || !carrier)
    return NextResponse.json({ error: "tracking_number and carrier required" }, { status: 400 });

  // Upsert into shipping table
  const rows = await profQuery(
    `INSERT INTO msbiz_order_shipping (order_id, tracking_number, carrier, inbound_status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (order_id) DO UPDATE
       SET tracking_number = $2, carrier = $3, inbound_status = 'pending', updated_at = now()
     RETURNING *`,
    [id, tracking_number, carrier]
  );

  // Mirror onto orders for backward compat
  await profQuery(
    `UPDATE msbiz_orders SET tracking_number = $1, carrier = $2, updated_at = now() WHERE id = $3`,
    [tracking_number, carrier, id]
  );

  return NextResponse.json({ shipping: rows[0] }, { status: 201 });
}
