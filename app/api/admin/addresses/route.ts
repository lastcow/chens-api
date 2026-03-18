import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, requireAdminRole } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

const LIMIT = 20;

// GET /api/admin/addresses?search=&owner_id=&shared=&page=
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req) ?? requireAdminRole(req);
  if (authErr) return authErr;

  const p       = req.nextUrl.searchParams;
  const search  = p.get("search")?.trim() ?? "";
  const ownerId = p.get("owner_id") ?? "";
  const shared  = p.get("shared") ?? "";
  const page    = Math.max(1, parseInt(p.get("page") ?? "1", 10));
  const offset  = (page - 1) * LIMIT;

  const conditions: string[] = ["1=1"];
  const values: unknown[] = [];
  let idx = 1;

  if (search.length >= 3) {
    conditions.push(
      `(a.full_address ILIKE $${idx} OR a.label ILIKE $${idx} OR a.contact_name ILIKE $${idx} OR a.contact_phone ILIKE $${idx})`
    );
    values.push(`%${search}%`); idx++;
  }
  if (ownerId) { conditions.push(`a.user_id = $${idx++}`); values.push(ownerId); }
  if (shared === "true")  conditions.push(`a.is_shared = true`);
  if (shared === "false") conditions.push(`(a.is_shared = false OR a.is_shared IS NULL)`);

  const where = `WHERE ${conditions.join(" AND ")}`;

  const [rows, countRows] = await Promise.all([
    profQuery<{
      id: string; label: string | null; full_address: string;
      street1: string | null; city: string | null; state: string | null;
      zip: string | null; country: string | null;
      contact_name: string | null; contact_phone: string | null;
      is_warehouse: boolean; is_shared: boolean;
      user_id: string | null; owner_name: string | null; owner_email: string | null;
      created_at: string; updated_at: string;
    }>(
      `SELECT a.*, u.name AS owner_name, u.email AS owner_email
       FROM msbiz_addresses a
       LEFT JOIN "User" u ON u.id = a.user_id
       ${where}
       ORDER BY a.is_shared DESC, a.created_at DESC
       LIMIT ${LIMIT} OFFSET $${idx}`,
      [...values, offset]
    ),
    profQuery<{ total: string }>(
      `SELECT COUNT(*) AS total FROM msbiz_addresses a ${where}`, values
    ),
  ]);

  // Fetch shared_users for all returned addresses in one query
  const ids = rows.map(r => r.id);
  let sharedMap: Record<string, { id: string; name: string | null; email: string }[]> = {};
  if (ids.length > 0) {
    const su = await profQuery<{ address_id: string; user_id: string; name: string | null; email: string }>(
      `SELECT s.address_id, s.user_id, u.name, u.email
       FROM address_shared_users s
       JOIN "User" u ON u.id = s.user_id
       WHERE s.address_id = ANY($1::text[])`,
      [ids]
    );
    for (const r of su) {
      if (!sharedMap[r.address_id]) sharedMap[r.address_id] = [];
      sharedMap[r.address_id].push({ id: r.user_id, name: r.name, email: r.email });
    }
  }

  const addresses = rows.map(r => ({ ...r, shared_users: sharedMap[r.id] ?? [] }));
  const total = parseInt(countRows[0]?.total ?? "0", 10);
  return NextResponse.json({ addresses, total, page, pages: Math.ceil(total / LIMIT) });
}

// POST /api/admin/addresses
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req) ?? requireAdminRole(req);
  if (authErr) return authErr;

  const body = await req.json();
  const {
    label, full_address, street, street1, street2, city, state, zip, country,
    google_place_id, lat, lng, is_warehouse, is_shared,
  } = body;
  const contact_name    = body.contact_name ?? body.name ?? null;
  const contact_phone   = body.contact_phone ?? body.phone ?? null;
  const owner_id        = body.owner_id ?? body.user_id ?? null;
  const shared_user_ids: string[] = body.shared_user_ids ?? [];
  const streetVal       = street ?? street1 ?? null;

  if (!full_address) return NextResponse.json({ error: "full_address is required" }, { status: 400 });

  const rows = await profQuery<{ id: string }>(
    `INSERT INTO msbiz_addresses
       (user_id, label, full_address, street1, street2, city, state, zip, country,
        google_place_id, lat, lng, is_warehouse, is_shared, contact_name, contact_phone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING id`,
    [owner_id, label ?? null, full_address, streetVal, street2 ?? null,
     city ?? null, state ?? null, zip ?? null, country ?? "US",
     google_place_id ?? null, lat ?? null, lng ?? null,
     is_warehouse ?? false, is_shared ?? false, contact_name, contact_phone]
  );

  const newId = rows[0].id;
  // Insert shared users — exclude owner
  for (const uid of shared_user_ids.filter(id => id !== owner_id)) {
    await profQuery(
      `INSERT INTO address_shared_users (address_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [newId, uid]
    );
  }

  return NextResponse.json({ address: { id: newId } }, { status: 201 });
}
