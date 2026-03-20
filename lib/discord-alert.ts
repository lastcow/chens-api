const WEBHOOK_URL = process.env.DISCORD_ERROR_WEBHOOK ?? "";

export async function discordAlert(opts: {
  title: string;
  message: string;
  path?: string;
  level?: "error" | "warning" | "info";
}) {
  if (!WEBHOOK_URL) return;
  const colors = { error: 0xef4444, warning: 0xf59e0b, info: 0x3b82f6 };
  const icons  = { error: "🔴", warning: "🟡", info: "🔵" };
  const level  = opts.level ?? "error";
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: `${icons[level]} ${opts.title}`,
          color: colors[level],
          fields: [
            ...(opts.path ? [{ name: "Path", value: `\`${opts.path}\``, inline: true }] : []),
            { name: "Time", value: new Date().toISOString(), inline: true },
            { name: "Detail", value: `\`\`\`${opts.message.slice(0, 900)}\`\`\`` },
          ],
          footer: { text: "chens-api · Runtime Alert" },
        }],
      }),
    });
  } catch {
    // never throw — alerts must not break the request
  }
}

/** Wrap a route handler — catches unhandled errors, alerts Discord, re-throws */
export function withDiscordAlert<T>(
  path: string,
  fn: () => Promise<T>
): Promise<T> {
  return fn().catch(async (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    await discordAlert({ title: "Unhandled API Error", message: msg, path });
    throw err;
  });
}
