import type { LambdaUrlEvent, LambdaResponse } from "./types.js";
import { postEmails } from "./routes/postEmails.js";
import { getEmails } from "./routes/getEmails.js";
import { emailTrack } from "./routes/emailTrack.js";

/**
 * CORS headers required for browser requests originating from the Chrome
 * extension running in the mail.google.com context. These headers must be
 * present on every response (not just OPTIONS preflights) so the browser
 * allows the extension to read response bodies.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://mail.google.com",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * Lambda Function URL handler.
 *
 * Routes requests based on the HTTP method + rawPath. The URL-based internal
 * router avoids the cost and complexity of API Gateway.
 *
 * Routes:
 *   OPTIONS *                    → CORS preflight
 *   POST /emails                 → postEmails
 *   GET  /emails                 → getEmails
 *   GET  /emailTrack/{pixelId}   → emailTrack
 */
export async function handler(event: LambdaUrlEvent): Promise<LambdaResponse> {
  const { method } = event.requestContext.http;
  const path = event.rawPath;

  // OPTIONS preflight — must be handled before all other routes so browsers
  // can complete the preflight check before sending the actual request.
  if (method === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  // POST /emails
  if (method === "POST" && path === "/emails") {
    const response = await postEmails(event.body);
    return { ...response, headers: { ...CORS_HEADERS, ...response.headers } };
  }

  // GET /emails
  if (method === "GET" && path === "/emails") {
    const response = await getEmails();
    return { ...response, headers: { ...CORS_HEADERS, ...response.headers } };
  }

  // GET /emailTrack/{pixelId}
  const trackMatch = /^\/emailTrack\/([^/]+)$/.exec(path);
  if (method === "GET" && trackMatch) {
    const pixelId = trackMatch[1];
    const sourceIp = event.requestContext.http.sourceIp ?? "unknown";
    const userAgent = event.headers?.["user-agent"] ?? "unknown";
    const response = await emailTrack(pixelId, sourceIp, userAgent);
    return { ...response, headers: { ...CORS_HEADERS, ...response.headers } };
  }

  return {
    statusCode: 404,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ error: "Not found", path, method }),
  };
}
