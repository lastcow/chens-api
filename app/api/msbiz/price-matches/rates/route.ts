import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    full_refund_rate: parseFloat(process.env.PM_FULL_REFUND_AWARD ?? "0.15"),
    partial_refund_rate: parseFloat(process.env.PM_PARTIAL_REFUND_AWARD ?? "0.10"),
  });
}
