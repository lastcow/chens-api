import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "costs.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const p = req.nextUrl.searchParams;
  const type = p.get("type");
  const from = p.get("from");
  const to = p.get("to");

  const conditions = [`user_id = $1`];
  const values: unknown[] = [uid];
  let idx = 2;
  if (type) { conditions.push(`type = $${idx++}`); values.push(type); }
  if (from) { conditions.push(`paid_at >= $${idx++}`); values.push(from); }
  if (to)   { conditions.push(`paid_at <= $${idx++}`); values.push(to); }

  const costs = await profQuery(
    `SELECT * FROM msbiz_costs WHERE ${conditions.join(" AND ")} ORDER BY paid_at DESC, created_at DESC`,
    values
  );

  // Summary by type
  const summary = await profQuery(
    `SELECT type, SUM(amount) AS total, COUNT(*) AS count
     FROM msbiz_costs WHERE ${conditions.join(" AND ")} GROUP BY type ORDER BY total DESC`,
    values
  );

  const grandTotal = costs.reduce((s: number, c: Record<string, unknown>) => s + Number(c.amount), 0);

  return NextResponse.json({ costs, summary, grand_total: grandTotal });
}

export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "costs.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const { type, ref_id, ref_type, payee, amount, currency = "USD", paid_at, description, receipt_url } = await req.json();
  if (!type || !amount) return NextResponse.json({ error: "type and amount required" }, { status: 400 });

  const rows = await profQuery(
    `INSERT INTO msbiz_costs (user_id, type, ref_id, ref_type, payee, amount, currency, paid_at, description, receipt_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [uid, type, ref_id ?? null, ref_type ?? null, payee ?? null, amount, currency, paid_at ?? null, description ?? null, receipt_url ?? null]
  );
  return NextResponse.json({ cost: rows[0] }, { status: 201 });
}
