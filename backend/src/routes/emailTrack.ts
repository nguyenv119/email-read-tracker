import { getRecord, updateOpens } from "../db.js";
import { notifyOpen } from "../ntfy.js";
import { PIXEL_PNG } from "../pixel.js";
import type { LambdaResponse } from "../types.js";

/**
 * GET /emailTrack/{pixelId}
 *
 * Looks up the tracking record for the given pixelId, appends an OpenEvent,
 * sends an ntfy.sh notification, and returns the 1x1 transparent PNG.
 *
 * Always returns the PNG even if the pixel_id is not found, to avoid
 * revealing tracking metadata to email clients.
 */
export async function emailTrack(
  pixelId: string,
  sourceIp: string,
  userAgent: string
): Promise<LambdaResponse> {
  const pngResponse: LambdaResponse = {
    statusCode: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
    body: PIXEL_PNG.toString("base64"),
    isBase64Encoded: true,
  };

  const record = await getRecord(pixelId);
  if (!record) {
    // Unknown pixel — still return the PNG to avoid broken image in email client
    return pngResponse;
  }

  // Gmail's image proxy pre-fetches all images when displaying emails, which
  // would trigger false "opened" events. Filter these out so only real opens
  // from actual email clients are recorded.
  if (/GoogleImageProxy/i.test(userAgent)) {
    return pngResponse;
  }

  // Gmail also pre-fetches images with a spoofed regular browser user agent
  // immediately after the email is sent (within seconds). A real human cannot
  // open an email that fast. Ignore opens within 30 seconds of sent_at.
  const sentTime = new Date(record.sent_at).getTime();
  const now = Date.now();
  const secondsSinceSend = (now - sentTime) / 1000;
  if (secondsSinceSend < 30) {
    return pngResponse;
  }

  const openEvent = {
    timestamp: new Date().toISOString(),
    ip: sourceIp,
    user_agent: userAgent,
  };

  // Run update and notification concurrently; do not fail the pixel response
  // if either side effect errors — the email client must always receive a valid image.
  await Promise.allSettled([
    updateOpens(pixelId, openEvent),
    notifyOpen(pixelId, record.recipient),
  ]);

  return pngResponse;
}
