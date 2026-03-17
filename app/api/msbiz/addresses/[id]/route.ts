import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "addresses.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;
  const body = await req.json();

  // Accept 'street' from frontend, map to 'street1' in DB
  if (body.street !== undefined && body.street1 === undefined) body.street1 = body.street;
  // Accept 'name'/'phone' as aliases for contact_name/contact_phone
  if (body.name !== undefined && body.contact_name === undefined) body.contact_name = body.name;
  if (body.phone !== undefined && body.contact_phone === undefined) body.contact_phone = body.phone;
  const fields = ["label","full_address","street1","street2","city","state","zip","country","google_place_id","lat","lng","is_warehouse","contact_name","contact_phone"];
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const f of fields) {
    if (body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(body[f]); }
  }
  if (!updates.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  updates.push(`updated_at = now()`);
  values.push(id, uid);
  await profQuery(
    `UPDATE msbiz_addresses SET ${updates.join(", ")} WHERE id = $${idx} AND (user_id = $${idx+1} OR is_shared = true)`,
    values
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "addresses.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;
  await profQuery(`DELETE FROM msbiz_addresses WHERE id = $1 AND user_id = $2`, [id, uid]);
  return NextResponse.json({ ok: true });
}
