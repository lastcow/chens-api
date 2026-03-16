import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "price_match.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const reminders = await profQuery(
    `SELECT * FROM msbiz_reminders
     WHERE user_id = $1 AND status IN ('pending', 'sent')
     ORDER BY remind_at ASC`,
    [uid]
  );
  return NextResponse.json({ reminders });
}
