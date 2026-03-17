import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, requireAdmin } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;

  const p = req.nextUrl.searchParams;
  const search = p.get("search") ?? "";
  const status = p.get("status") ?? "";
  const page   = parseInt(p.get("page") ?? "1", 10);
  const limit  = parseInt(p.get("limit") ?? "20", 10);
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (search) {
    conditions.push(`(m.name ILIKE $${idx} OR u.name ILIKE $${idx} OR u.email ILIKE $${idx})`);
    values.push(`%${search}%`); idx++;
  }
  if (status) { conditions.push(`po.status = $${idx++}`); values.push(status); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows, countRows] = await Promise.all([
    profQuery(
      `SELECT po.*, 
              u.name AS requester_name, u.email AS requester_email,
              m.name AS merchandise_name, m.upc, m.model, m.image_url, m.price AS merchandise_price,
              w.name AS warehouse_name
       FROM purchase_orders po
       LEFT JOIN "User" u ON u.id = po.requester_id
       LEFT JOIN merchandise m ON m.id = po.merchandise_id
       LEFT JOIN msbiz_warehouses w ON w.id = po.warehouse_id
       ${where}
       ORDER BY po.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset]
    ),
    profQuery(`SELECT COUNT(*) AS total FROM purchase_orders po
       LEFT JOIN "User" u ON u.id = po.requester_id
       LEFT JOIN merchandise m ON m.id = po.merchandise_id
       ${where}`, values),
  ]);

  return NextResponse.json({
    orders: rows,
    total: parseInt(String((countRows[0] as { total: string }).total), 10),
    page, limit,
  });
}

export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;

  const { requester_id, merchandise_id, qty, required_price, deadline, warehouse_id, notes } = await req.json();
  if (!requester_id || !merchandise_id) return NextResponse.json({ error: "requester_id and merchandise_id are required" }, { status: 400 });

  const rows = await profQuery(
    `INSERT INTO purchase_orders (requester_id, merchandise_id, qty, required_price, deadline, warehouse_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [requester_id, merchandise_id, qty ?? 1, required_price ?? null, deadline ?? null, warehouse_id ?? null, notes ?? null]
  );
  return NextResponse.json({ order: rows[0] }, { status: 201 });
}
