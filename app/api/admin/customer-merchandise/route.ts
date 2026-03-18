import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, requireAdmin } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

// GET /api/admin/customer-merchandise?user_id=&merchandise_id=&search=&page=&limit=
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;

  const p = req.nextUrl.searchParams;
  const search       = p.get("search") ?? "";
  const userFilter   = p.get("user_id") ?? "";
  const merchFilter  = p.get("merchandise_id") ?? "";
  const page  = parseInt(p.get("page") ?? "1", 10);
  const limit = parseInt(p.get("limit") ?? "20", 10);
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (search) {
    conditions.push(
      `(to_tsvector('english', coalesce(m.name,'') || ' ' || coalesce(u.name,'') || ' ' || coalesce(u.email,'')) @@ plainto_tsquery('english', $${idx}) ` +
      `OR m.name ILIKE $${idx + 1} OR u.name ILIKE $${idx + 1} OR u.email ILIKE $${idx + 1})`
    );
    values.push(search, `%${search}%`); idx += 2;
  }
  if (userFilter)  { conditions.push(`cm.user_id = $${idx++}`);          values.push(userFilter); }
  if (merchFilter) { conditions.push(`cm.merchandise_id = $${idx++}`);   values.push(merchFilter); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [rows, countRows] = await Promise.all([
    profQuery(
      `SELECT cm.id, cm.user_id, cm.merchandise_id, cm.custom_price, cm.notes, cm.created_at,
              u.name AS user_name, u.email AS user_email,
              m.name AS merchandise_name, m.upc, m.model, m.image_url, m.price AS list_price
       FROM customer_merchandise cm
       JOIN "User" u ON u.id = cm.user_id
       JOIN merchandise m ON m.id = cm.merchandise_id
       JOIN user_module_permissions p ON p.user_id = cm.user_id AND p.module = 'msbiz' AND p.role_name = 'customer'
       ${where}
       ORDER BY u.name ASC, m.name ASC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset]
    ),
    profQuery(`SELECT COUNT(*) AS total FROM customer_merchandise cm
       JOIN "User" u ON u.id = cm.user_id
       JOIN merchandise m ON m.id = cm.merchandise_id
       JOIN user_module_permissions p ON p.user_id = cm.user_id AND p.module = 'msbiz' AND p.role_name = 'customer'
       ${where}`, values),
  ]);

  return NextResponse.json({
    items: rows,
    total: parseInt(String((countRows[0] as { total: string }).total), 10),
    page, limit,
  });
}

// POST /api/admin/customer-merchandise
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;

  const { user_id, merchandise_id, custom_price, notes } = await req.json();
  if (!user_id || !merchandise_id || custom_price == null)
    return NextResponse.json({ error: "user_id, merchandise_id, and custom_price are required" }, { status: 400 });

  const rows = await profQuery(
    `INSERT INTO customer_merchandise (user_id, merchandise_id, custom_price, notes)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, merchandise_id) DO UPDATE
       SET custom_price = EXCLUDED.custom_price, notes = EXCLUDED.notes, updated_at = now()
     RETURNING *`,
    [user_id, merchandise_id, custom_price, notes ?? null]
  );
  return NextResponse.json({ item: rows[0] }, { status: 201 });
}
