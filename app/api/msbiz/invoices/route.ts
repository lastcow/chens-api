import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "invoices.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const status = req.nextUrl.searchParams.get("status");
  const conditions = [`user_id = $1`];
  const values: unknown[] = [uid];
  if (status) { conditions.push(`status = $2`); values.push(status); }

  const invoices = await profQuery(
    `SELECT * FROM msbiz_invoices WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
    values
  );
  return NextResponse.json({ invoices });
}

export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "invoices.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const { qb_customer_id, qb_customer_name, order_ids = [], subtotal = 0, tax = 0, total, currency = "USD", issued_at, due_at, notes } = await req.json();

  const finalTotal = total ?? (Number(subtotal) + Number(tax));

  const rows = await profQuery(
    `INSERT INTO msbiz_invoices (user_id, qb_customer_id, qb_customer_name, order_ids, subtotal, tax, total, currency, issued_at, due_at, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [uid, qb_customer_id ?? null, qb_customer_name ?? null, JSON.stringify(order_ids), subtotal, tax, finalTotal, currency, issued_at ?? null, due_at ?? null, notes ?? null]
  );
  return NextResponse.json({ invoice: rows[0] }, { status: 201 });
}
