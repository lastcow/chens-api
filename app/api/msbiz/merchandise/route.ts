import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

// GET /api/msbiz/merchandise?search=&limit=
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "orders.view");
  if (result instanceof NextResponse) return result;

  const p      = req.nextUrl.searchParams;
  const search = p.get("search")?.trim() ?? "";
  const limit  = Math.min(500, parseInt(p.get("limit") ?? "100", 10));

  const conditions: string[] = ["1=1"];
  const values: unknown[] = [];
  let idx = 1;

  if (search.length >= 2) {
    conditions.push(
      `(m.name ILIKE $${idx} OR m.upc ILIKE $${idx} OR m.model ILIKE $${idx})`
    );
    values.push(`%${search}%`); idx++;
  }

  const items = await profQuery(
    `SELECT id, name, upc, model, image_url, price
     FROM merchandise m
     WHERE ${conditions.join(" AND ")}
     ORDER BY name ASC
     LIMIT ${limit} OFFSET 0`,
    values
  );

  return NextResponse.json({ items });
}
