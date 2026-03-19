import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

const EASYPOST_KEY = process.env.EASYPOST_API_KEY;

async function fetchEasyPostTracker(tracking_number: string, carrier?: string) {
  if (!EASYPOST_KEY) return null;
  try {
    const res = await fetch("https://api.easypost.com/v2/trackers", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${EASYPOST_KEY}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tracker: { tracking_code: tracking_number, carrier: carrier ?? undefined } }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

function mapEasyPostEvents(tracker: Record<string, unknown>) {
  const details = (tracker.tracking_details as Record<string, unknown>[]) ?? [];
  return details.map((d: Record<string, unknown>) => ({
    status: tracker.status,
    event_type: d.status,
    description: d.message,
    location: d.tracking_location
      ? `${(d.tracking_location as Record<string, string>).city ?? ""}, ${(d.tracking_location as Record<string, string>).state ?? ""}`.trim().replace(/^,\s*/, "")
      : null,
    event_at: d.datetime,
  }));
}

// GET /api/msbiz/tracking/:ref_type/:ref_id
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "tracking.view");
  if (result instanceof NextResponse) return result;

  const ref_type = req.nextUrl.searchParams.get("ref_type");
  const ref_id   = req.nextUrl.searchParams.get("ref_id");
  if (!ref_type || !ref_id) return NextResponse.json({ error: "ref_type and ref_id required" }, { status: 400 });

  const events = await profQuery(
    `SELECT * FROM msbiz_tracking_events
     WHERE ref_id = $1 AND ref_type = $2
     ORDER BY event_at DESC NULLS LAST, created_at DESC`,
    [ref_id, ref_type]
  );
  return NextResponse.json({ events });
}

// POST /api/msbiz/tracking — add/refresh tracking
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "tracking.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const { ref_id, ref_type, tracking_number, carrier, refresh = false } = await req.json();
  if (!ref_id || !ref_type || !tracking_number) {
    return NextResponse.json({ error: "ref_id, ref_type, tracking_number required" }, { status: 400 });
  }

  if (refresh) {
    // Clear old events for this tracking number
    await profQuery(`DELETE FROM msbiz_tracking_events WHERE ref_id = $1 AND ref_type = $2`, [ref_id, ref_type]);
  }

  // Fetch from EasyPost
  const tracker = await fetchEasyPostTracker(tracking_number, carrier ?? undefined);
  let events: Record<string, unknown>[] = [];

  if (tracker) {
    events = mapEasyPostEvents(tracker);
    const latestStatus = tracker.status as string;

    // Upsert tracking events
    for (const evt of events) {
      await profQuery(
        `INSERT INTO msbiz_tracking_events (ref_id, ref_type, tracking_number, carrier, status, event_type, description, location, event_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT DO NOTHING`,
        [ref_id, ref_type, tracking_number, carrier ?? null, latestStatus, evt.event_type ?? null, evt.description ?? null, evt.location ?? null, evt.event_at ?? null]
      );
    }

    // Update parent record status + inbound_status + tracking info
    if (ref_type === "order") {
      const orderStatusMap: Record<string, string> = { delivered: "delivered", out_for_delivery: "shipped", in_transit: "shipped", pre_transit: "processing", failure: "exception", return_to_sender: "exception", error: "exception" };
      const inboundMap: Record<string, string> = { delivered: "delivered", out_for_delivery: "out_for_delivery", in_transit: "in_transit", pre_transit: "ordered", failure: "in_transit", return_to_sender: "in_transit", error: "in_transit" };
      const mappedStatus   = orderStatusMap[latestStatus] ?? null;
      const mappedInbound  = inboundMap[latestStatus] ?? "ordered";
      await profQuery(
        `UPDATE msbiz_orders SET inbound_status = $1, tracking_number = $2, carrier = $3${mappedStatus ? ", status = $4" : ""}, updated_at = now() WHERE id = ${mappedStatus ? "$5" : "$4"} AND user_id = ${mappedStatus ? "$6" : "$5"}`,
        mappedStatus
          ? [mappedInbound, tracking_number, carrier ?? null, mappedStatus, ref_id, uid]
          : [mappedInbound, tracking_number, carrier ?? null, ref_id, uid]
      );
      // Also update the shipping table
      await profQuery(
        `UPDATE msbiz_order_shipping SET inbound_status = $1, updated_at = now() WHERE order_id = $2`,
        [mappedInbound, ref_id]
      );
    } else if (ref_type === "outbound") {
      const statusMap: Record<string, string> = { delivered: "delivered", out_for_delivery: "shipped", in_transit: "shipped", failure: "exception" };
      const mapped = statusMap[latestStatus] ?? null;
      if (mapped) {
        await profQuery(`UPDATE msbiz_outbound SET status = $1, updated_at = now() WHERE id = $2 AND user_id = $3`, [mapped, ref_id, uid]);
        if (mapped === "delivered") {
          await profQuery(`UPDATE msbiz_outbound SET delivered_at = now(), updated_at = now() WHERE id = $1 AND user_id = $2 AND delivered_at IS NULL`, [ref_id, uid]);
        }
      }
    }

    // Auto-create exception if delivery failed
    if (["failure", "return_to_sender", "error"].includes(latestStatus)) {
      const exists = await profQuery(`SELECT id FROM msbiz_exceptions WHERE ref_id = $1 AND ref_type = $2 AND type = 'shipment' AND status != 'resolved'`, [ref_id, ref_type]);
      if (!exists.length) {
        await profQuery(
          `INSERT INTO msbiz_exceptions (user_id, type, ref_id, ref_type, severity, title, description)
           VALUES ($1, 'shipment', $2, $3, 'high', 'Shipment failed', $4)`,
          [uid, ref_id, ref_type, `Tracking ${tracking_number}: ${latestStatus}`]
        );
      }
    }
  }

  return NextResponse.json({ ok: true, events_count: events.length, easypost: !!tracker });
}
