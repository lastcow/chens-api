import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey, requireAdmin } from "@/lib/auth";

// GET /api/users/:id — get a single user
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, createdAt: true, image: true, oauth_provider: true, suspended: true },
  });

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ user });
}

// PATCH /api/users/:id — update user (admin only for role/suspend changes)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const { id } = await params;
  const body = await req.json();

  // Role or suspend changes require admin
  if (body.role !== undefined || body.suspended !== undefined) {
    const adminErr = requireAdmin(req);
    if (adminErr) return adminErr;
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.image && { image: body.image }),
        ...(body.role && { role: body.role }),
        ...(body.suspended !== undefined && { suspended: body.suspended }),
      },
      select: { id: true, name: true, email: true, role: true, suspended: true, updatedAt: true },
    });
    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
}

// DELETE /api/users/:id — delete user (admin only)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;

  const { id } = await params;
  try {
    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ message: "User deleted" });
  } catch {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
}
