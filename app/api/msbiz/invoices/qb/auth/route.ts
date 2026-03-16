import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

const QB_CLIENT_ID = process.env.QB_CLIENT_ID!;
const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET!;
const QB_REDIRECT_URI = process.env.QB_REDIRECT_URI ?? `${process.env.APP_URL}/api/msbiz/invoices/qb/callback`;
const QB_SANDBOX = process.env.QB_SANDBOX === "true";
const QB_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QB_SCOPES = "com.intuit.quickbooks.accounting";

// QB tokens stored in a simple kv-style table (or we reuse msbiz_audit_log approach)
// For simplicity: store as a special cost record with type='qb_token' (encrypted)
// Better: dedicated table. Using profQuery with msbiz_accounts pattern.

// GET /api/msbiz/invoices/qb/auth — get OAuth URL
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "invoices.qb_sync");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const state = Buffer.from(JSON.stringify({ uid, ts: Date.now() })).toString("base64");
  const url = new URL(QB_AUTH_URL);
  url.searchParams.set("client_id", QB_CLIENT_ID);
  url.searchParams.set("scope", QB_SCOPES);
  url.searchParams.set("redirect_uri", QB_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

  return NextResponse.json({ auth_url: url.toString() });
}

// POST /api/msbiz/invoices/qb/callback — exchange code for tokens
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "invoices.qb_sync");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const { code, realm_id, state } = await req.json();
  if (!code || !realm_id) return NextResponse.json({ error: "code and realm_id required" }, { status: 400 });

  const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: QB_REDIRECT_URI }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return NextResponse.json({ error: `QB OAuth error: ${err}` }, { status: 502 });
  }

  const tokens = await tokenRes.json();
  const { encrypt } = await import("@/lib/crypto");

  // Store tokens in DB (encrypted)
  await profQuery(
    `INSERT INTO msbiz_accounts (user_id, email, password_enc, display_name, status, notes)
     VALUES ($1, 'qb_tokens', $2, 'QuickBooks OAuth', 'active', $3)
     ON CONFLICT (user_id, (email)) DO UPDATE SET password_enc = $2, notes = $3, updated_at = now()`,
    [uid, encrypt(JSON.stringify(tokens)), realm_id]
  ).catch(async () => {
    // Fallback: update existing qb_tokens record
    await profQuery(
      `UPDATE msbiz_accounts SET password_enc = $1, notes = $2, updated_at = now()
       WHERE user_id = $3 AND email = 'qb_tokens'`,
      [encrypt(JSON.stringify(tokens)), realm_id, uid]
    );
  });

  return NextResponse.json({ ok: true, realm_id });
}
