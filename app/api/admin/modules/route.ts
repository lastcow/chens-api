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

  return NextResponse.json({ module: record });
}
