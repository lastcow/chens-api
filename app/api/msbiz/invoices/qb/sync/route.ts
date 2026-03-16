import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { profQuery } from "@/lib/prof-db";
import { requireMsbizPermission } from "@/lib/msbiz-auth";
import { decrypt, encrypt } from "@/lib/crypto";

const QB_CLIENT_ID = process.env.QB_CLIENT_ID!;
const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET!;
const QB_BASE = process.env.QB_SANDBOX === "true"
  ? "https://sandbox-quickbooks.api.intuit.com/v3/company"
  : "https://quickbooks.api.intuit.com/v3/company";

async function getQBTokens(uid: string) {
  const rows = await profQuery<{ password_enc: string; notes: string }>(
    `SELECT password_enc, notes FROM msbiz_accounts WHERE user_id = $1 AND email = 'qb_tokens'`, [uid]
  );
  if (!rows[0]) return null;
  const tokens = JSON.parse(decrypt(rows[0].password_enc));
  return { tokens, realm_id: rows[0].notes };
}

async function refreshQBToken(uid: string, refresh_token: string) {
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token }),
  });
  if (!res.ok) throw new Error(`QB token refresh failed: ${await res.text()}`);
  const newTokens = await res.json();
  await profQuery(
    `UPDATE msbiz_accounts SET password_enc = $1, updated_at = now() WHERE user_id = $2 AND email = 'qb_tokens'`,
    [encrypt(JSON.stringify(newTokens)), uid]
  );
  return newTokens;
}

async function qbFetch(url: string, tokens: Record<string, string>, uid: string, realm_id: string, method = "GET", body?: Record<string, unknown>) {
  let t = tokens;
  const makeReq = async (accessToken: string) =>
    fetch(url, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  let res = await makeReq(t.access_token);
  if (res.status === 401) {
    t = await refreshQBToken(uid, t.refresh_token);
    res = await makeReq(t.access_token);
  }
  return res;
}

// POST /api/msbiz/invoices/qb/sync — sync invoice to QB or pull status
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "invoices.qb_sync");
  if (result instanceof NextResponse) return result;
  const { uid } = result;

  const { invoice_id, action = "create" } = await req.json();
  if (!invoice_id) return NextResponse.json({ error: "invoice_id required" }, { status: 400 });

  const qbCreds = await getQBTokens(uid);
  if (!qbCreds) return NextResponse.json({ error: "QuickBooks not connected. Please authorize first." }, { status: 400 });
  const { tokens, realm_id } = qbCreds;

  const invRows = await profQuery<{
    id: string; qb_customer_id: string; qb_customer_name: string;
    order_ids: string[]; subtotal: number; tax: number; total: number;
    issued_at: string; due_at: string; notes: string; qb_invoice_id: string;
  }>(`SELECT * FROM msbiz_invoices WHERE id = $1 AND user_id = $2`, [invoice_id, uid]);
  if (!invRows.length) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  const inv = invRows[0];

  if (action === "create" || action === "update") {
    const lineItems = [
      { DetailType: "SalesItemLineDetail", Amount: inv.subtotal, SalesItemLineDetail: { ItemRef: { value: "1", name: "Services" } } },
      ...(inv.tax > 0 ? [{ DetailType: "SalesItemLineDetail", Amount: inv.tax, SalesItemLineDetail: { ItemRef: { value: "2", name: "Tax" } } }] : []),
    ];

    const qbInvoice = {
      CustomerRef: { value: inv.qb_customer_id, name: inv.qb_customer_name },
      Line: lineItems,
      DueDate: inv.due_at ? new Date(inv.due_at).toISOString().split("T")[0] : undefined,
      PrivateNote: inv.notes ?? `Order IDs: ${(inv.order_ids as string[]).join(", ")}`,
    };

    const url = inv.qb_invoice_id
      ? `${QB_BASE}/${realm_id}/invoice/${inv.qb_invoice_id}?minorversion=65`
      : `${QB_BASE}/${realm_id}/invoice?minorversion=65`;

    const res = await qbFetch(url, tokens, uid, realm_id, inv.qb_invoice_id ? "POST" : "POST", { Invoice: qbInvoice });
    const data = await res.json();

    if (!res.ok) {
      await profQuery(`UPDATE msbiz_invoices SET qb_error = $1, qb_synced_at = now(), updated_at = now() WHERE id = $2`, [JSON.stringify(data), invoice_id]);
      return NextResponse.json({ error: "QB API error", details: data }, { status: 502 });
    }

    const qbId = data.Invoice?.Id;
    await profQuery(
      `UPDATE msbiz_invoices SET qb_invoice_id = COALESCE($1, qb_invoice_id), qb_error = NULL, qb_synced_at = now(), status = 'sent', updated_at = now() WHERE id = $2`,
      [qbId ?? null, invoice_id]
    );
    return NextResponse.json({ ok: true, qb_invoice_id: qbId });

  } else if (action === "status") {
    if (!inv.qb_invoice_id) return NextResponse.json({ error: "Invoice not yet synced to QB" }, { status: 400 });
    const res = await qbFetch(`${QB_BASE}/${realm_id}/invoice/${inv.qb_invoice_id}?minorversion=65`, tokens, uid, realm_id);
    const data = await res.json();
    const qbStatus = data.Invoice?.Balance === 0 ? "paid" : data.Invoice?.Balance > 0 ? "sent" : "draft";
    await profQuery(
      `UPDATE msbiz_invoices SET status = $1, qb_synced_at = now(), updated_at = now() ${qbStatus === "paid" ? ", paid_at = now()" : ""} WHERE id = $2`,
      [qbStatus, invoice_id]
    );
    return NextResponse.json({ ok: true, status: qbStatus, qb_balance: data.Invoice?.Balance });
  }

  return NextResponse.json({ error: "action must be create, update, or status" }, { status: 400 });
}
