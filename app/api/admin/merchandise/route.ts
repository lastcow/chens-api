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
  const offset   = (page - 1) * limit;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (search) {
    // Full-text search via tsvector; also prefix-match UPC/model for exact code lookups
    conditions.push(
      `(search_vec @@ plainto_tsquery('english', $${idx}) ` +
      `OR name ILIKE $${idx + 1} OR upc ILIKE $${idx + 1} OR model ILIKE $${idx + 1})`
    );
    values.push(search, `%${search}%`);
    idx += 2;
  }
  if (status) { conditions.push(`status = $${idx++}`); values.push(status); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const orderBy = search
    ? `ORDER BY ts_rank(search_vec, plainto_tsquery('english', $1)) DESC, created_at DESC`
    : `ORDER BY created_at DESC`;

  const [rows, countRows] = await Promise.all([
    profQuery(`SELECT * FROM merchandise ${where} ${orderBy} LIMIT $${idx} OFFSET $${idx+1}`,
      [...values, limit, offset]),
    profQuery(`SELECT COUNT(*) AS total FROM merchandise ${where}`, values),
  ]);

  return NextResponse.json({ items: rows, total: parseInt(String((countRows[0] as { total: string }).total), 10) });
}

export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;

  const { name, upc, model, description, price, cost, stock, unit, status, image_url, item_url } = await req.json();
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const rows = await profQuery(
    `INSERT INTO merchandise (name, upc, model, description, price, cost, stock, unit, status, image_url, item_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [name, upc ?? null, model ?? null, description ?? null,
     price ?? 0, cost ?? null, stock ?? 0, unit ?? "unit",
     status ?? "active", image_url ?? null, item_url ?? null]
  );
  return NextResponse.json({ item: rows[0] }, { status: 201 });
}
