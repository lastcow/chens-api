import { NextRequest, NextResponse } from "next/server";

const DISCORD_WEBHOOK_URL = process.env.DISCORD_ERROR_WEBHOOK ?? "";
const DRAIN_SECRET = process.env.VERCEL_LOG_DRAIN_SECRET ?? "";

// Vercel log drain verification (GET request)
export async function GET(req: NextRequest) {
  const verifyToken = req.headers.get("x-vercel-verify");
  if (verifyToken) {
    return new NextResponse(verifyToken, { status: 200, headers: { "x-vercel-verify": verifyToken } });
  }
  return NextResponse.json({ ok: true, service: "vercel-log-drain" });
}

export async function POST(req: NextRequest) {
  // Verify secret token from Vercel log drain header
  const secret = req.headers.get("x-vercel-log-drain-token");
  if (DRAIN_SECRET && secret !== DRAIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let logs: Record<string, unknown>[];
  try {
    logs = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!DISCORD_WEBHOOK_URL) {
    return NextResponse.json({ ok: true, skipped: "no discord webhook configured" });
  }

  // Filter for errors only
  const errors = logs.filter(l => {
    const level = (l.level as string ?? "").toLowerCase();
    const msg = (l.message as string ?? l.text as string ?? "").toLowerCase();
    return level === "error" || level === "warning" ||
      msg.includes("error") || msg.includes("unhandled") ||
      msg.includes("500") || msg.includes("exception");
  });

  if (!errors.length) return NextResponse.json({ ok: true, filtered: logs.length });

  // Group and send to Discord
  for (const err of errors.slice(0, 5)) { // max 5 per batch
    const msg = (err.message as string) || (err.text as string) || JSON.stringify(err);
    const path = (err.requestPath as string) || (err.path as string) || "";
    const ts = err.timestamp ? new Date(err.timestamp as number).toISOString() : new Date().toISOString();

    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "⚠️ Vercel Error",
          color: 0xef4444,
          fields: [
            path ? { name: "Path", value: `\`${path}\``, inline: true } : null,
            { name: "Time", value: ts, inline: true },
            { name: "Message", value: `\`\`\`${msg.slice(0, 500)}\`\`\`` },
          ].filter(Boolean),
          footer: { text: "chens-api · Vercel Log Drain" },
        }],
      }),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, forwarded: errors.length });
}
