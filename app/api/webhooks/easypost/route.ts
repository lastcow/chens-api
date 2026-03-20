import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { profQuery } from "@/lib/prof-db";

const WEBHOOK_SECRET = process.env.EASYPOST_WEBHOOK_SECRET ?? "";

function verifySignature(body: string, signature: string | null): boolean {
  if (!WEBHOOK_SECRET || !signature) return !WEBHOOK_SECRET; // skip if no secret configured
  const expected = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
  return signature === expected;
}

const ORDER_STATUS_MAP: Record<string, string> = {
  delivered:          "order.delivered",
  out_for_delivery:   "order.shipped",
  in_transit:         "order.shipped",
  pre_transit:        "order.shipped",
  failure:            "order.exception",
  return_to_sender:   "order.exception",
  error:              "order.exception",
};

const INBOUND_MAP: Record<string, string> = {
  delivered:          "delivered",
  out_for_delivery:   "out_for_delivery",
  in_transit:         "in_transit",
  pre_transit:        "ordered",
  failure:            "in_transit",
  return_to_sender:   "in_transit",
  error:              "in_transit",
};

export async function POST(req: NextRequest) {
  const raw       = await req.text();
  const signature = req.headers.get("x-hmac-signature-256");

  if (!verifySignature(raw, signature)) {
    console.warn("[EasyPost webhook] invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = payload.description as string ?? "";
  if (!eventType.startsWith("tracker.")) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const result = payload.result as Record<string, unknown> ?? {};
  const trackingCode = result.tracking_code as string;
  const carrier      = result.carrier as string;
  const status       = result.status as string;

  if (!trackingCode || !status) {
    return NextResponse.json({ ok: true, skipped: "missing fields" });
  }

  const inboundStatus = INBOUND_MAP[status]  ?? "ordered";
  const orderStatus   = ORDER_STATUS_MAP[status] ?? null;

  // Find matching shipping record
  const shipping = await profQuery<{ id: string; order_id: string }>(
    `SELECT id, order_id FROM msbiz_order_shipping WHERE tracking_number = $1`,
    [trackingCode]
  );

  if (!shipping.length) {
    return NextResponse.json({ ok: true, skipped: "no matching order" });
  }

  const { order_id } = shipping[0];

  // Update shipping table (inbound_status lives here now)
  await profQuery(
    `UPDATE msbiz_order_shipping SET inbound_status = $1, updated_at = now() WHERE order_id = $2`,
    [inboundStatus, order_id]
  );

  // Update order status only (inbound_status/tracking columns removed from msbiz_orders)
  if (orderStatus) {
    await profQuery(
      `UPDATE msbiz_orders
       SET status = CASE WHEN status NOT IN ('order.delivered','order.confirmed') THEN $1 ELSE status END,
           updated_at = now()
       WHERE id = $2`,
      [orderStatus, order_id]
    );
  }

  // Store tracking event
  const details = (result.tracking_details as Record<string, unknown>[]) ?? [];
  for (const d of details.slice(0, 5)) {
    const loc = d.tracking_location as Record<string, string> | null;
    await profQuery(
      `INSERT INTO msbiz_tracking_events
         (ref_id, ref_type, tracking_number, carrier, status, event_type, description, location, event_at)
       VALUES ($1,'order',$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tracking_number, event_at, status) WHERE event_at IS NOT NULL DO NOTHING`,
      [order_id, trackingCode, carrier ?? null, status,
       d.status ?? null, d.message ?? null,
       loc ? `${loc.city ?? ""}, ${loc.state ?? ""}`.replace(/^,\s*/, "") : null,
       d.datetime ?? null]
    );
  }

  // Auto-create exception if delivery failed
  if (["failure","return_to_sender","error"].includes(status)) {
    const exists = await profQuery(
      `SELECT id FROM msbiz_exceptions WHERE ref_id = $1 AND ref_type = 'order' AND type = 'shipment' AND status != 'resolved'`,
      [order_id]
    );
    if (!exists.length) {
      const order = await profQuery(`SELECT user_id FROM msbiz_orders WHERE id = $1`, [order_id]);
      if (order[0]) {
        await profQuery(
          `INSERT INTO msbiz_exceptions (user_id, type, ref_id, ref_type, severity, title, description)
           VALUES ($1,'shipment',$2,'order','high','Shipment failed',$3)`,
          [order[0].user_id, order_id, `Tracking ${trackingCode}: ${status}`]
        );
      }
    }
  }

  console.log(`[EasyPost webhook] ${eventType} → order ${order_id}: ${status} (${inboundStatus})`);
  return NextResponse.json({ ok: true, order_id, status, inbound_status: inboundStatus });
}
