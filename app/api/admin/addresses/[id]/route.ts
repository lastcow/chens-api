import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, requireAdminRole } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(_req) ?? requireAdminRole(_req);
  if (authErr) return authErr;
  const { id } = await params;
  const rows = await profQuery(
    `SELECT a.*, u.name AS owner_name, u.email AS owner_email
     FROM msbiz_addresses a
     LEFT JOIN "User" u ON u.id = a.user_id
     WHERE a.id = $1`,
    [id]
  );
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ address: rows[0] });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req) ?? requireAdminRole(req);
  if (authErr) return authErr;
  const { id } = await params;
  const body = await req.json();

  // normalise field aliases
  if (body.street  !== undefined && body.street1       === undefined) body.street1       = body.street;
  if (body.name    !== undefined && body.contact_name  === undefined) body.contact_name  = body.name;
  if (body.phone   !== undefined && body.contact_phone === undefined) body.contact_phone = body.phone;
  if (body.owner_id !== undefined && body.user_id      === undefined) body.user_id       = body.owner_id;

  const allowed = [
    "user_id","label","full_address","street1","street2","city","state","zip","country",
    "google_place_id","lat","lng","is_warehouse","is_shared","contact_name","contact_phone",
  ];
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const f of allowed) {
    if (body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(body[f]); }
  }
  if (!updates.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  updates.push(`updated_at = now()`);
  values.push(id);
  await profQuery(
    `UPDATE msbiz_addresses SET ${updates.join(", ")} WHERE id = $${idx}`,
    values
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req) ?? requireAdminRole(req);
  if (authErr) return authErr;
  const { id } = await params;
  await profQuery(`DELETE FROM msbiz_addresses WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
