import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "warehouse.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const warehouses = await profQuery(
    `SELECT w.*, a.full_address AS address_text
     FROM msbiz_warehouses w
     LEFT JOIN msbiz_addresses a ON a.id = w.address_id
     WHERE w.user_id = $1 AND w.active = true
     ORDER BY w.name`,
    [uid]
  );
  return NextResponse.json({ warehouses });
}

export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "warehouse.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const { name, address_id, owner_name, owner_contact, inbound_cost_per_unit = 0, outbound_cost_per_unit = 0, notes } = await req.json();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const rows = await profQuery(
    `INSERT INTO msbiz_warehouses (user_id, name, address_id, owner_name, owner_contact, inbound_cost_per_unit, outbound_cost_per_unit, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [uid, name, address_id ?? null, owner_name ?? null, owner_contact ?? null, inbound_cost_per_unit, outbound_cost_per_unit, notes ?? null]
  );
  return NextResponse.json({ warehouse: rows[0] }, { status: 201 });
}
