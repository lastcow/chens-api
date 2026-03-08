import { NextResponse } from "next/server";

// GET /api/health — public health check
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "ChensAPI",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
}
