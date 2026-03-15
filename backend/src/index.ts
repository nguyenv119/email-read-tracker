import type { LambdaUrlEvent, LambdaResponse } from "./types.js";
import { postEmails } from "./routes/postEmails.js";
import { getEmails } from "./routes/getEmails.js";
import { emailTrack } from "./routes/emailTrack.js";

/**
 * Lambda Function URL handler.
 *
 * Routes requests based on the HTTP method + rawPath. The URL-based internal
 * router avoids the cost and complexity of API Gateway.
 *
 * Routes:
 *   POST /emails                 → postEmails
 *   GET  /emails                 → getEmails
 *   GET  /emailTrack/{pixelId}   → emailTrack
 */
export async function handler(event: LambdaUrlEvent): Promise<LambdaResponse> {
  const { method } = event.requestContext.http;
  const path = event.rawPath;

  // POST /emails
  if (method === "POST" && path === "/emails") {
    return postEmails(event.body);
  }

  // GET /emails
  if (method === "GET" && path === "/emails") {
    return getEmails();
  }

  // GET /emailTrack/{pixelId}
  const trackMatch = /^\/emailTrack\/([^/]+)$/.exec(path);
  if (method === "GET" && trackMatch) {
    const pixelId = trackMatch[1];
    const sourceIp = event.requestContext.http.sourceIp ?? "unknown";
    const userAgent = event.headers?.["user-agent"] ?? "unknown";
    return emailTrack(pixelId, sourceIp, userAgent);
  }

  return {
    statusCode: 404,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: "Not found", path, method }),
  };
}
