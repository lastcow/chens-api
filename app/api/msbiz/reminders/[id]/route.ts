import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "reminders.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;
  const { action, snooze_hours = 24 } = await req.json();

  if (action === "dismiss") {
    await profQuery(`UPDATE msbiz_reminders SET status = 'dismissed' WHERE id = $1 AND user_id = $2`, [id, uid]);
  } else if (action === "snooze") {
    await profQuery(
      `UPDATE msbiz_reminders SET status = 'snoozed', remind_at = now() + ($1 || ' hours')::INTERVAL WHERE id = $2 AND user_id = $3`,
      [snooze_hours, id, uid]
    );
  } else {
    return NextResponse.json({ error: "action must be 'dismiss' or 'snooze'" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
