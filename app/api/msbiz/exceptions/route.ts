import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "exceptions.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const p = req.nextUrl.searchParams;
  const type = p.get("type");
  const severity = p.get("severity");
  const status = p.get("status") ?? "open";

  const conditions = [`e.user_id = $1`];
  const values: unknown[] = [uid];
  let idx = 2;
  if (type)     { conditions.push(`e.type = $${idx++}`);     values.push(type); }
  if (severity) { conditions.push(`e.severity = $${idx++}`); values.push(severity); }
  if (status !== "all") { conditions.push(`e.status = $${idx++}`); values.push(status); }

  const exceptions = await profQuery(
    `SELECT * FROM msbiz_exceptions WHERE ${conditions.join(" AND ")}
     ORDER BY
       CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
       created_at DESC`,
    values
  );
  return NextResponse.json({ exceptions });
}

export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "exceptions.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const { type, ref_id, ref_type, severity = "medium", title, description, assigned_to } = await req.json();
  if (!type || !title) return NextResponse.json({ error: "type and title required" }, { status: 400 });

  const rows = await profQuery(
    `INSERT INTO msbiz_exceptions (user_id, type, ref_id, ref_type, severity, title, description, assigned_to)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [uid, type, ref_id ?? null, ref_type ?? null, severity, title, description ?? null, assigned_to ?? null]
  );

  // Bump exception_count on the referenced order if applicable
  if (ref_type === "order" && ref_id) {
    await profQuery(
      `UPDATE msbiz_orders SET exception_count = exception_count + 1, status = 'exception', updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [ref_id, uid]
    );
  }

  return NextResponse.json({ exception: rows[0] }, { status: 201 });
}
