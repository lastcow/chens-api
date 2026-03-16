import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey, requireAdmin } from "@/lib/auth";

// GET /api/admin/modules — all users with their module states
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, image: true, role: true },
    orderBy: { createdAt: "asc" },
  });

  const allModules = await prisma.userModule.findMany();

  const result = users.map((u) => ({
    ...u,
    modules: allModules
      .filter((m) => m.user_id === u.id)
      .reduce((acc, m) => ({ ...acc, [m.module]: m.enabled }), {} as Record<string, boolean>),
  }));

  return NextResponse.json({ users: result });
}

// PUT /api/admin/modules — toggle a module for a user
export async function PUT(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;

  const { userId, module, enabled } = await req.json();
  if (!userId || !module || enabled === undefined) {
    return NextResponse.json({ error: "Missing userId, module, or enabled" }, { status: 400 });
  }

  const record = await prisma.userModule.upsert({
    where: { user_id_module: { user_id: userId, module } },
    update: { enabled },
    create: { user_id: userId, module, enabled },
  });

  // For invite-only modules (msbiz): sync enable/disable to user_module_permissions
  if (module === "msbiz") {
    const { profQuery } = await import("@/lib/prof-db");
    if (enabled) {
      // Grant default operator permissions if none exist
      const existing = await profQuery(
        `SELECT id FROM user_module_permissions WHERE user_id = $1 AND module = 'msbiz'`,
        [userId]
      );
      if (!existing.length) {
        const operatorPerms = {
          "orders.view": true, "orders.create": true, "orders.edit": true, "orders.delete": false,
          "pm.view": true, "pm.manage": true, "pm.approve": false,
          "warehouse.view": true, "warehouse.manage": false,
          "inbound.view": true, "inbound.create": true, "inbound.receive": true,
          "outbound.view": true, "outbound.create": true,
          "invoices.view": true, "invoices.manage": false, "invoices.qb_sync": false,
          "tracking.view": true,
          "exceptions.view": true, "exceptions.create": true, "exceptions.resolve": false,
          "costs.view": true, "costs.manage": false,
          "accounts.view": true, "accounts.manage": false,
          "addresses.view": true, "addresses.manage": false,
          "admin.users": false, "admin.invites": false, "admin.addresses": false,
        };
        await profQuery(
          `INSERT INTO user_module_permissions (user_id, module, permissions, role_name)
           VALUES ($1, 'msbiz', $2, 'operator')`,
          [userId, JSON.stringify(operatorPerms)]
        );
      }
    } else {
      // Revoke permissions when disabled
      await profQuery(
        `DELETE FROM user_module_permissions WHERE user_id = $1 AND module = 'msbiz'`,
        [userId]
      );
    }
  }

  return NextResponse.json({ module: record });
}
