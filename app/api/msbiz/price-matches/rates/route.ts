import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    full_refund_rate:         parseFloat(process.env.PM_FULL_REFUND_AWARD            ?? "0.15"),
    partial_over_refund_rate: parseFloat(process.env.PM_PARTIAL_OVER_REFUND_AWARD    ?? "0.12"),
    partial_refund_rate:      parseFloat(process.env.PM_PARTIAL_REFUND_AWARD         ?? "0.10"),
    // Thresholds: < 25% of original → partial, 25–99% → partial_over, 100% → full
    partial_threshold: 0.25,
  });
}
