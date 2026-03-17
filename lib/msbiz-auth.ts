import { NextRequest, NextResponse } from "next/server";
import { profQuery } from "./prof-db";

export type MsbizPermission =
  | "accounts.view" | "accounts.manage"
  | "orders.view" | "orders.create" | "orders.edit" | "orders.delete" | "orders.import"
  | "addresses.view" | "addresses.manage"
  | "warehouse.view" | "warehouse.manage" | "inventory.adjust"
  | "inbound.view" | "inbound.manage"
  | "outbound.view" | "outbound.manage"
  | "price_match.view" | "price_match.manage"
  | "invoices.view" | "invoices.manage" | "invoices.qb_sync"
  | "exceptions.view" | "exceptions.manage" | "exceptions.resolve"
  | "costs.view" | "costs.manage"
  | "tracking.view"
  | "reminders.manage"
  | "admin.users" | "admin.roles" | "admin.invite" | "admin.addresses";

// Default permission sets per role
export const MSBIZ_ROLE_PERMISSIONS: Record<string, Record<MsbizPermission, boolean>> = {
  admin: {
    "accounts.view": true, "accounts.manage": true,
    "orders.view": true, "orders.create": true, "orders.edit": true, "orders.delete": true, "orders.import": true,
    "addresses.view": true, "addresses.manage": true,
    "warehouse.view": true, "warehouse.manage": true, "inventory.adjust": true,
    "inbound.view": true, "inbound.manage": true,
    "outbound.view": true, "outbound.manage": true,
    "price_match.view": true, "price_match.manage": true,
    "invoices.view": true, "invoices.manage": true, "invoices.qb_sync": true,
    "exceptions.view": true, "exceptions.manage": true, "exceptions.resolve": true,
    "costs.view": true, "costs.manage": true,
    "tracking.view": true,
    "reminders.manage": true,
    "admin.users": true, "admin.roles": true, "admin.invite": true, "admin.addresses": true,
  },
  manager: {
    "accounts.view": true, "accounts.manage": true,
    "orders.view": true, "orders.create": true, "orders.edit": true, "orders.delete": false, "orders.import": true,
    "addresses.view": true, "addresses.manage": true,
    "warehouse.view": true, "warehouse.manage": true, "inventory.adjust": true,
    "inbound.view": true, "inbound.manage": true,
    "outbound.view": true, "outbound.manage": true,
    "price_match.view": true, "price_match.manage": true,
    "invoices.view": true, "invoices.manage": false, "invoices.qb_sync": false,
    "exceptions.view": true, "exceptions.manage": true, "exceptions.resolve": true,
    "costs.view": true, "costs.manage": false,
    "tracking.view": true,
    "reminders.manage": true,
    "admin.users": false, "admin.roles": false, "admin.invite": false, "admin.addresses": false,
  },
  operator: {
    "accounts.view": true, "accounts.manage": false,
    "orders.view": true, "orders.create": true, "orders.edit": true, "orders.delete": false, "orders.import": false,
    "addresses.view": true, "addresses.manage": false,
    "warehouse.view": true, "warehouse.manage": false, "inventory.adjust": false,
    "inbound.view": true, "inbound.manage": true,
    "outbound.view": true, "outbound.manage": false,
    "price_match.view": true, "price_match.manage": true,
    "invoices.view": true, "invoices.manage": false, "invoices.qb_sync": false,
    "exceptions.view": true, "exceptions.manage": true, "exceptions.resolve": false,
    "costs.view": false, "costs.manage": false,
    "tracking.view": true,
    "reminders.manage": false,
    "admin.users": false, "admin.roles": false, "admin.invite": false, "admin.addresses": false,
  },
  viewer: {
    "accounts.view": true, "accounts.manage": false,
    "orders.view": true, "orders.create": false, "orders.edit": false, "orders.delete": false, "orders.import": false,
    "addresses.view": true, "addresses.manage": false,
    "warehouse.view": true, "warehouse.manage": false, "inventory.adjust": false,
    "inbound.view": true, "inbound.manage": false,
    "outbound.view": true, "outbound.manage": false,
    "price_match.view": true, "price_match.manage": false,
    "invoices.view": true, "invoices.manage": false, "invoices.qb_sync": false,
    "exceptions.view": true, "exceptions.manage": false, "exceptions.resolve": false,
    "costs.view": false, "costs.manage": false,
    "tracking.view": true,
    "reminders.manage": false,
    "admin.users": false, "admin.roles": false, "admin.invite": false, "admin.addresses": false,
  },
};

export async function getMsbizPermissions(userId: string): Promise<Record<string, boolean> | null> {
  const rows = await profQuery<{ permissions: Record<string, boolean> }>(
    `SELECT permissions FROM user_module_permissions WHERE user_id = $1 AND module = 'msbiz'`,
    [userId]
  );
  return rows[0]?.permissions ?? null;
}

export async function hasMsbizPermission(userId: string, permission: MsbizPermission): Promise<boolean> {
  const perms = await getMsbizPermissions(userId);
  if (!perms) return false;
  return perms[permission] === true;
}

export function msbizForbidden(permission: MsbizPermission): NextResponse {
  return NextResponse.json(
    { error: `Forbidden — requires permission: ${permission}` },
    { status: 403 }
  );
}

// Convenience: check permission and return error response if denied
export async function requireMsbizPermission(
  req: NextRequest,
  permission: MsbizPermission
): Promise<{ uid: string } | NextResponse> {
  const uid = req.headers.get("x-user-id");
  if (!uid) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });
  // System-level ADMINs bypass all msbiz permission checks
  const role = req.headers.get("x-user-role");
  if (role === "ADMIN") return { uid };
  const allowed = await hasMsbizPermission(uid, permission);
  if (!allowed) return msbizForbidden(permission);
  return { uid };
}
