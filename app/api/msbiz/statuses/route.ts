import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

// GET /api/msbiz/statuses?type=order
// Returns all statuses (or filtered by type) with their type info.
// Requires x-api-key only — reference data, no permission check needed.
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const typeFilter = req.nextUrl.searchParams.get("type");

  const [statuses, types] = await Promise.all([
    typeFilter
      ? profQuery(
          `SELECT s.*, t.label AS type_label
           FROM msbiz_statuses s
           JOIN msbiz_status_types t ON t.id = s.type_id
           WHERE s.type_id = $1
           ORDER BY s.sort_order ASC`,
          [typeFilter]
        )
      : profQuery(
          `SELECT s.*, t.label AS type_label
           FROM msbiz_statuses s
           JOIN msbiz_status_types t ON t.id = s.type_id
           ORDER BY s.type_id ASC, s.sort_order ASC`
        ),
    typeFilter
      ? profQuery(
          `SELECT * FROM msbiz_status_types WHERE id = $1`,
          [typeFilter]
        )
      : profQuery(`SELECT * FROM msbiz_status_types ORDER BY id ASC`),
  ]);

  return NextResponse.json({ statuses, types });
}
