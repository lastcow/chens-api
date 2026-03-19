import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";
import { encrypt, decrypt } from "@/lib/crypto";

// GET /api/msbiz/accounts
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "accounts.view");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const canManage = await (await import("@/lib/msbiz-auth")).hasMsbizPermission(uid, "accounts.manage");
  const roleHeader = req.headers.get("x-user-role");
  const showPass = canManage || roleHeader === "ADMIN";

  const p = req.nextUrl.searchParams;
  const search = p.get("search") ?? "";
  const status = p.get("status") ?? "";
  const page   = parseInt(p.get("page") ?? "1", 10);
  const limit  = parseInt(p.get("limit") ?? "20", 10);
  const offset = (page - 1) * limit;

  const conditions: string[] = ["a.user_id = $1"];
  const values: unknown[] = [uid];
  let idx = 2;

  if (search) {
    conditions.push(
      `(a.search_vec @@ plainto_tsquery('english', $${idx}) OR a.email ILIKE $${idx + 1} OR a.display_name ILIKE $${idx + 1})`
    );
    values.push(search, `%${search}%`);
    idx += 2;
  }
  if (status) { conditions.push(`a.status ILIKE $${idx++}`); values.push(status); }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const orderBy = search
    ? `ORDER BY ts_rank(a.search_vec, plainto_tsquery('english', $2)) DESC, a.created_at DESC`
    : `ORDER BY a.created_at DESC`;

  const [rows, countRows] = await Promise.all([
    profQuery<Record<string, unknown>>(
      `SELECT a.id, a.email, a.password_enc, a.display_name, a.status, a.notes, a.balance,
              a.owner_id, a.order_ids, a.last_used_at, a.created_at, a.updated_at,
              (SELECT COUNT(*) FROM msbiz_orders o WHERE o.account_id = a.id) AS order_count,
              (SELECT COUNT(*) FROM msbiz_orders o WHERE o.account_id = a.id AND o.pm_status IN ('submitted','approved')) AS pm_count,
              u.name AS owner_name, u.email AS owner_email
       FROM msbiz_accounts a
       LEFT JOIN "User" u ON u.id = a.owner_id
       ${where} ${orderBy} LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset]
    ),
    profQuery<{ total: string }>(
      `SELECT COUNT(*) AS total FROM msbiz_accounts a ${where}`, values
    ),
  ]);

  const accounts = rows.map(({ password_enc, ...rest }) => ({
    ...rest,
    ...(showPass && password_enc ? { password: decrypt(String(password_enc)) } : {}),
  }));

  return NextResponse.json({
    accounts,
    total: parseInt(String(countRows[0].total), 10),
    page,
    limit,
  });
}

// POST /api/msbiz/accounts
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "accounts.manage");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const { email, password, display_name, notes, balance, order_ids } = await req.json();
  if (!email || !password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });

  const password_enc = encrypt(password);

  const rows = await profQuery(
    `INSERT INTO msbiz_accounts (user_id, email, password_enc, display_name, notes, balance, owner_id, order_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, email, display_name, status, balance, owner_id, order_ids, created_at`,
    [uid, email.toLowerCase(), password_enc, display_name ?? null, notes ?? null,
     balance ?? 0, uid, order_ids ? JSON.stringify(order_ids) : '[]']
  );
  return NextResponse.json({ account: rows[0] }, { status: 201 });
}
