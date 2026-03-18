import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, requireAdminRole } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(_req) ?? requireAdminRole(_req);
  if (authErr) return authErr;
  const { id } = await params;

  const [rows, su] = await Promise.all([
    profQuery(
      `SELECT a.*, u.name AS owner_name, u.email AS owner_email
       FROM msbiz_addresses a
       LEFT JOIN "User" u ON u.id = a.user_id
       WHERE a.id = $1`,
      [id]
    ),
    profQuery<{ user_id: string; name: string | null; email: string }>(
      `SELECT s.user_id, u.name, u.email
       FROM address_shared_users s
       JOIN "User" u ON u.id = s.user_id
       WHERE s.address_id = $1`,
      [id]
    ),
  ]);
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ address: { ...rows[0], shared_users: su } });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req) ?? requireAdminRole(req);
  if (authErr) return authErr;
  const { id } = await params;
  const body = await req.json();

  // field aliases
  if (body.street   !== undefined && body.street1       === undefined) body.street1       = body.street;
  if (body.name     !== undefined && body.contact_name  === undefined) body.contact_name  = body.name;
  if (body.phone    !== undefined && body.contact_phone === undefined) body.contact_phone = body.phone;
  if (body.owner_id !== undefined && body.user_id       === undefined) body.user_id       = body.owner_id;

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
  if (!updates.length && body.shared_user_ids === undefined)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  if (updates.length) {
    updates.push(`updated_at = now()`);
    values.push(id);
    await profQuery(`UPDATE msbiz_addresses SET ${updates.join(", ")} WHERE id = $${idx}`, values);
  }

  // Replace shared_users if provided
  if (Array.isArray(body.shared_user_ids)) {
    const owner_id = body.user_id ?? body.owner_id;
    const newIds: string[] = (body.shared_user_ids as string[]).filter(uid => uid !== owner_id);
    await profQuery(`DELETE FROM address_shared_users WHERE address_id = $1`, [id]);
    for (const uid of newIds) {
      await profQuery(
        `INSERT INTO address_shared_users (address_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, uid]
      );
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req) ?? requireAdminRole(req);
  if (authErr) return authErr;
  const { id } = await params;
  // shared_users cascade-deletes via FK
  await profQuery(`DELETE FROM msbiz_addresses WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
