import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, requireAdmin } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;
  const { id } = await params;
  const rows = await profQuery(`SELECT * FROM merchandise WHERE id = $1`, [id]);
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ item: rows[0] });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;
  const { id } = await params;
  const body = await req.json();

  const editable = ["name","upc","model","description","price","cost","stock","unit","status","image_url","item_url"];
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const f of editable) {
    if (body[f] !== undefined) {
      updates.push(`${f} = $${idx++}`);
      values.push(f === "tags" ? JSON.stringify(body[f]) : body[f]);
    }
  }
  if (!updates.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  updates.push(`updated_at = now()`);
  values.push(id);
  await profQuery(`UPDATE merchandise SET ${updates.join(", ")} WHERE id = $${idx}`, values);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;
  const { id } = await params;
  await profQuery(`DELETE FROM merchandise WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
