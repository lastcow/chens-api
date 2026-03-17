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
    conditions.push(
      `(po.search_vec @@ plainto_tsquery('english', $${idx}) ` +
      `OR to_tsvector('english', coalesce(m.name,'')) @@ plainto_tsquery('english', $${idx}) ` +
      `OR to_tsvector('english', coalesce(u.name,'') || ' ' || coalesce(u.email,'')) @@ plainto_tsquery('english', $${idx}) ` +
      `OR po.po_number ILIKE $${idx + 1} OR u.email ILIKE $${idx + 1})`
    );
    values.push(search, `%${search}%`);
    idx += 2;
  }
  if (status) { conditions.push(`po.status = $${idx++}`); values.push(status); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const orderBy = search
    ? `ORDER BY ts_rank(po.search_vec, plainto_tsquery('english', $2)) DESC, po.created_at DESC`
    : `ORDER BY po.created_at DESC`;

  const [rows, countRows] = await Promise.all([
    profQuery(
      `SELECT po.id, po.po_number, po.requester_id, po.merchandise_id, po.qty, po.completed_qty,
              po.required_price, po.deadline, po.warehouse_id, po.status, po.notes,
              po.created_at, po.updated_at,
              u.name AS requester_name, u.email AS requester_email,
              m.name AS merchandise_name, m.upc, m.model, m.image_url, m.price AS merchandise_price,
              w.name AS warehouse_name,
              a.full_address AS warehouse_address, a.contact_name AS warehouse_contact_name, a.contact_phone AS warehouse_contact_phone
       FROM purchase_orders po
       LEFT JOIN "User" u ON u.id = po.requester_id
       LEFT JOIN merchandise m ON m.id = po.merchandise_id
       LEFT JOIN msbiz_warehouses w ON w.id = po.warehouse_id
       LEFT JOIN msbiz_addresses a ON a.id = w.address_id
       ${where} ${orderBy}
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

  // Generate PO number: PO-YYYYMMDD-XXXX (retry on collision)
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let po_number = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = Math.floor(1000 + Math.random() * 9000).toString();
    const candidate = `PO-${today}-${suffix}`;
    const existing = await profQuery(`SELECT id FROM purchase_orders WHERE po_number = $1`, [candidate]);
    if (!existing.length) { po_number = candidate; break; }
  }
  if (!po_number) return NextResponse.json({ error: "Failed to generate unique PO number" }, { status: 500 });

  const rows = await profQuery(
    `INSERT INTO purchase_orders (po_number, requester_id, merchandise_id, qty, required_price, deadline, warehouse_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [po_number, requester_id, merchandise_id, qty ?? 1, required_price ?? null, deadline ?? null, warehouse_id ?? null, notes ?? null]
  );
  return NextResponse.json({ order: rows[0] }, { status: 201 });
}
