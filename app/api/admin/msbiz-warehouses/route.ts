import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, requireAdmin } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";

// GET /api/admin/msbiz-warehouses — list all warehouses with full address
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;

  const warehouses = await profQuery(
    `SELECT w.id, w.name, w.address_id,
            a.full_address, a.city, a.state, a.zip
     FROM msbiz_warehouses w
     LEFT JOIN msbiz_addresses a ON a.id = w.address_id
     ORDER BY w.name ASC`
  );
  return NextResponse.json({ warehouses });
}
