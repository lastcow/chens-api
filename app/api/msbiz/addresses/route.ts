import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

// GET /api/msbiz/addresses
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "addresses.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const isWarehouse = req.nextUrl.searchParams.get("is_warehouse");

  const addresses = await profQuery(
    `SELECT DISTINCT a.*, a.street1 AS street
     FROM msbiz_addresses a
     LEFT JOIN address_shared_users s ON s.address_id = a.id AND s.user_id = $1
     WHERE (a.user_id = $1 OR a.is_shared = true OR s.user_id IS NOT NULL)
     ${isWarehouse !== null ? `AND a.is_warehouse = ${isWarehouse === "true"}` : ""}
     ORDER BY a.is_shared DESC, a.created_at DESC`,
    [uid]
  );
  return NextResponse.json({ addresses });
}

// POST /api/msbiz/addresses
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "addresses.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const body = await req.json();
  // Accept 'name'/'phone' as aliases for contact_name/contact_phone
  const { label, full_address, street, street1, street2, city, state, zip, country, google_place_id, lat, lng, is_warehouse } = body;
  const contact_name = body.contact_name ?? body.name ?? null;
  const contact_phone = body.contact_phone ?? body.phone ?? null;
  if (!full_address) return NextResponse.json({ error: "full_address is required" }, { status: 400 });
  const streetVal = street ?? street1 ?? null; // accept both 'street' and 'street1'

  const rows = await profQuery(
    `INSERT INTO msbiz_addresses (user_id, label, full_address, street1, street2, city, state, zip, country, google_place_id, lat, lng, is_warehouse, contact_name, contact_phone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *, street1 AS street`,
    [uid, label ?? null, full_address, streetVal, street2 ?? null, city ?? null, state ?? null, zip ?? null, country ?? "US", google_place_id ?? null, lat ?? null, lng ?? null, is_warehouse ?? false, contact_name ?? null, contact_phone ?? null]
  );
  return NextResponse.json({ address: rows[0] }, { status: 201 });
}
