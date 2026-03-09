import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/auth";

// GET /api/user/modules — get module list for a user
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "Missing x-user-id" }, { status: 400 });

  const modules = await prisma.userModule.findMany({ where: { user_id: userId } });
  return NextResponse.json({ modules });
}
