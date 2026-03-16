import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "reminders.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const rows = await profQuery(`SELECT * FROM msbiz_pm_rules WHERE user_id = $1`, [uid]);
  // Return defaults if not configured yet
  const rules = rows[0] ?? { user_id: uid, pm_window_days: 14, remind_days_before: 3, notify_discord: true, notify_email: false, enabled: true };
  return NextResponse.json({ rules });
}

export async function PUT(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "reminders.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const { pm_window_days, remind_days_before, notify_discord, notify_email, enabled } = await req.json();

  await profQuery(
    `INSERT INTO msbiz_pm_rules (user_id, pm_window_days, remind_days_before, notify_discord, notify_email, enabled)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       pm_window_days = COALESCE($2, msbiz_pm_rules.pm_window_days),
       remind_days_before = COALESCE($3, msbiz_pm_rules.remind_days_before),
       notify_discord = COALESCE($4, msbiz_pm_rules.notify_discord),
       notify_email = COALESCE($5, msbiz_pm_rules.notify_email),
       enabled = COALESCE($6, msbiz_pm_rules.enabled),
       updated_at = now()`,
    [uid, pm_window_days ?? null, remind_days_before ?? null, notify_discord ?? null, notify_email ?? null, enabled ?? null]
  );
  return NextResponse.json({ ok: true });
}
