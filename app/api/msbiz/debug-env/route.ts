import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth";

// Temporary debug endpoint — remove after diagnosing
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;

  const key = process.env.GOOGLE_MAPS_API_KEY;
  return NextResponse.json({
    GOOGLE_MAPS_API_KEY_set: !!key,
    GOOGLE_MAPS_API_KEY_length: key?.length ?? 0,
    GOOGLE_MAPS_API_KEY_prefix: key ? key.slice(0, 6) + "…" : null,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
  });
}
