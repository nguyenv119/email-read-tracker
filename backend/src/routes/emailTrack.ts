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

  // --- Gmail false-open filters ---
  //
  // Gmail pre-fetches images two ways, both triggering false "opened" events:
  //
  // 1. GoogleImageProxy: fires on real opens but identified by UA string.
  //    We actually WANT these — they indicate a real user opened the email.
  //    However, the proxy also fires during delivery for active sessions.
  //
  // 2. Spoofed browser UA: uses a frozen "Chrome/42 + Edge/12" combo that
  //    no real browser has. This is the prefetch bot that fires ~2s after send.
  //    See: https://www.gmass.co/blog/false-opens-in-gmail/
  //
  // Filter strategy: block the known bot UA, plus a 10-second timing safety
  // net for any future bot variants we haven't fingerprinted yet.

  // Block Gmail's prefetch bot (impossible Chrome/42 + Edge/12 combo)
  if (/Chrome\/42\..*Edge\/12\./i.test(userAgent)) {
    return pngResponse;
  }

  // Block GoogleImageProxy (fires during delivery for active Gmail sessions)
  if (/GoogleImageProxy/i.test(userAgent)) {
    return pngResponse;
  }

  // Safety net: ignore any open within 5 seconds of send. Gmail's prefetch
  // hits at ~2s; delivery + inbox render + human reaction takes longer than 5s.
  const secondsSinceSend = (Date.now() - new Date(record.sent_at).getTime()) / 1000;
  if (secondsSinceSend < 5) {
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
