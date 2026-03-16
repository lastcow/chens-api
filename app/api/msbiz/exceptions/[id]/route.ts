import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "exceptions.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;
  const { id } = await params;

  const rows = await profQuery(`SELECT * FROM msbiz_exceptions WHERE id = $1 AND user_id = $2`, [id, uid]);
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ exception: rows[0] });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const perm = await requireMsbizPermission(req, "exceptions.manage");
  if (perm instanceof NextResponse) return perm;
  const { uid } = perm;
  const { id } = await params;
  const body = await req.json();

  // Resolve requires separate permission
  if (body.status === "resolved") {
    const canResolve = await (await import("@/lib/msbiz-auth")).hasMsbizPermission(uid, "exceptions.resolve");
    if (!canResolve) return NextResponse.json({ error: "Forbidden — requires exceptions.resolve" }, { status: 403 });
  }

  const editable = ["severity","title","description","status","assigned_to","resolution_notes"];
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const f of editable) {
    if (body[f] !== undefined) { updates.push(`${f} = $${idx++}`); values.push(body[f]); }
  }
  if (body.status === "resolved") { updates.push(`resolved_at = now()`); }
  if (!updates.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  updates.push(`updated_at = now()`);
  values.push(id, uid);
  await profQuery(`UPDATE msbiz_exceptions SET ${updates.join(", ")} WHERE id = $${idx} AND user_id = $${idx+1}`, values);
  return NextResponse.json({ ok: true });
}
