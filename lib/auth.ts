import { NextRequest, NextResponse } from "next/server";

/**
 * Validates the API key from the request header.
 * Returns a 401 response if invalid, or null if valid.
 */
export function requireApiKey(req: NextRequest): NextResponse | null {
  const key = req.headers.get("x-api-key");
  if (!key || key !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Validates that the caller has admin role (passed via x-user-role header).
 * Used for admin-only endpoints.
 */
export function requireAdmin(req: NextRequest): NextResponse | null {
  const role = req.headers.get("x-user-role");
  if (role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
