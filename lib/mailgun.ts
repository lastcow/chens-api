const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY!;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN!;
const FROM_EMAIL = process.env.MAILGUN_FROM || `MS Business <noreply@${process.env.MAILGUN_DOMAIN}>`;
const BASE_URL = process.env.APP_URL || "https://dev.chen.me";

export async function sendInviteEmail({
  to,
  invitedBy,
  token,
  roleName,
}: {
  to: string;
  invitedBy: string;
  token: string;
  roleName: string;
}) {
  const acceptUrl = `${BASE_URL}/msbiz/accept-invite?token=${token}`;

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #e2e8f0; padding: 32px; border-radius: 12px;">
      <h1 style="color: #f59e0b; font-size: 24px; margin-bottom: 8px;">You're invited to MS Business</h1>
      <p style="color: #94a3b8; margin-bottom: 24px;">
        <strong style="color: #e2e8f0;">${invitedBy}</strong> has invited you to join the MS Business module as <strong style="color: #f59e0b;">${roleName}</strong>.
      </p>
      <a href="${acceptUrl}" style="display: inline-block; background: #f59e0b; color: #0f172a; font-weight: bold; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 15px;">
        Accept Invitation
      </a>
      <p style="color: #64748b; font-size: 13px; margin-top: 24px;">
        This invitation expires in 7 days. If you did not expect this invitation, you can safely ignore it.
      </p>
      <hr style="border-color: #1e293b; margin: 24px 0;" />
      <p style="color: #475569; font-size: 12px;">Chen's — MS Business Module</p>
    </div>
  `;

  const text = `You're invited to join the MS Business module as ${roleName}.\n\nAccept your invitation: ${acceptUrl}\n\nThis link expires in 7 days.`;

  const form = new FormData();
  form.append("from", FROM_EMAIL);
  form.append("to", to);
  form.append("subject", "Invitation to MS Business Module");
  form.append("html", html);
  form.append("text", text);

  const res = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString("base64")}`,
    },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mailgun error: ${res.status} — ${err}`);
  }

  return res.json();
}
