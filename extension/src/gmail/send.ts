/**
 * Per-recipient email sender via the Gmail REST API.
 *
 * For each recipient:
 *  1. Generate a unique pixel_id (crypto.randomUUID)
 *  2. Clone the body HTML and inject a tracking pixel <img>
 *  3. Build an RFC 2822 MIME message
 *  4. Base64url-encode it
 *  5. POST to gmail.users.messages.send with Authorization: Bearer {token}
 *  6. Thread subsequent sends using the threadId from the first response
 *
 * After all sends succeed, POST metadata to the backend /emails endpoint.
 */

import type { CreateEmailRequest } from "../../../shared/src/types.js";
import { BACKEND_URL } from "../config.js";

const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export interface SendOptions {
  token: string;
  from: string;
  recipients: string[];
  subject: string;
  bodyHtml: string;
}

/**
 * Build an RFC 2822 MIME message string.
 */
function buildMime(
  from: string,
  to: string,
  subject: string,
  bodyHtml: string
): string {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    bodyHtml,
  ].join("\r\n");
}

/**
 * Base64url-encode a string (RFC 4648 §5).
 */
function toBase64url(str: string): string {
  const b64 = btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_m, p1: string) =>
      String.fromCharCode(parseInt(p1, 16))
    )
  );
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Inject a tracking pixel into body HTML before the closing </body> tag,
 * or append it at the end if no </body> is present.
 */
function injectPixel(bodyHtml: string, pixelUrl: string): string {
  const img = `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />`;
  if (bodyHtml.includes("</body>")) {
    return bodyHtml.replace("</body>", `${img}</body>`);
  }
  return bodyHtml + img;
}

/**
 * Send one RFC 2822 message via the Gmail API.
 *
 * @throws {Error} on non-OK HTTP response
 */
async function gmailSend(
  token: string,
  raw: string,
  threadId?: string
): Promise<{ id: string; threadId: string }> {
  const body: Record<string, string> = { raw };
  if (threadId) body["threadId"] = threadId;

  const res = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(
      `Gmail API error ${res.status}: ${JSON.stringify(detail)}`
    );
  }

  return res.json() as Promise<{ id: string; threadId: string }>;
}

/**
 * Send individualized tracked copies to each recipient, then record
 * metadata on the backend.
 */
export async function sendTrackedEmails(opts: SendOptions): Promise<void> {
  const { token, from, recipients, subject, bodyHtml } = opts;

  const email_group_id = crypto.randomUUID();
  const sent_at = new Date().toISOString();

  const recipientMeta: { email: string; pixel_id: string }[] = [];
  let threadId: string | undefined;

  for (const recipient of recipients) {
    const pixel_id = crypto.randomUUID();
    const pixelUrl = `${BACKEND_URL}/emailTrack/${pixel_id}`;
    const trackedBody = injectPixel(bodyHtml, pixelUrl);
    const mime = buildMime(from, recipient, subject, trackedBody);
    const raw = toBase64url(mime);

    const result = await gmailSend(token, raw, threadId);
    threadId = result.threadId;

    recipientMeta.push({ email: recipient, pixel_id });
  }

  // Post tracking metadata to the backend
  const payload: CreateEmailRequest = {
    email_group_id,
    recipients: recipientMeta,
    subject,
    sent_at,
  };

  const res = await fetch(`${BACKEND_URL}/emails`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(
      `Backend POST /emails failed ${res.status}: ${JSON.stringify(detail)}`
    );
  }
}
