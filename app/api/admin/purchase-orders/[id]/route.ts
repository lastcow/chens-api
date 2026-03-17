import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, requireAdmin } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;
  const { id } = await params;
  const body = await req.json();

  const editable = ["requester_id","merchandise_id","qty","required_price","deadline","warehouse_id","status","notes"];
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const f of editable) {
    if (body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(body[f]); }
  }
  if (!updates.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  updates.push(`updated_at = now()`);
  values.push(id);
  await profQuery(`UPDATE purchase_orders SET ${updates.join(", ")} WHERE id = $${idx}`, values);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;
  const { id } = await params;
  await profQuery(`DELETE FROM purchase_orders WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
