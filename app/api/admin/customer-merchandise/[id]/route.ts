import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, requireAdmin } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;
  const { id } = await params;
  const { custom_price, notes } = await req.json();

  if (custom_price == null) return NextResponse.json({ error: "custom_price is required" }, { status: 400 });

  await profQuery(
    `UPDATE customer_merchandise SET custom_price = $1, notes = $2, updated_at = now() WHERE id = $3`,
    [custom_price, notes ?? null, id]
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;
  const { id } = await params;
  await profQuery(`DELETE FROM customer_merchandise WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
