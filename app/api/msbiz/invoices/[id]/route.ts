import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "invoices.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;

  const rows = await profQuery(`SELECT * FROM msbiz_invoices WHERE id = $1 AND user_id = $2`, [id, uid]);
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ invoice: rows[0] });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "invoices.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;
  const body = await req.json();

  const editable = ["qb_customer_id","qb_customer_name","order_ids","status","subtotal","tax","total","currency","issued_at","due_at","paid_at","notes"];
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const f of editable) {
    if (body[f] !== undefined) {
      updates.push(`${f} = $${idx++}`);
      values.push(f === "order_ids" ? JSON.stringify(body[f]) : body[f]);
    }
  }
  if (!updates.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  updates.push(`updated_at = now()`);
  values.push(id, uid);
  await profQuery(`UPDATE msbiz_invoices SET ${updates.join(", ")} WHERE id = $${idx} AND user_id = $${idx+1}`, values);
  return NextResponse.json({ ok: true });
}
