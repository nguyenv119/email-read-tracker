import type { CreateEmailRequest } from "@mailtrack/shared";
import { putRecord } from "../db.js";
import type { LambdaResponse } from "../types.js";

/**
 * POST /emails
 *
 * Accepts a CreateEmailRequest body and writes one EmailTrackingRecord per
 * recipient to DynamoDB. Returns 201 with the count of created records.
 */
export async function postEmails(body: string | null | undefined): Promise<LambdaResponse> {
  if (!body) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Request body is required" }),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  const req = parsed as Partial<CreateEmailRequest>;
  if (
    !req.email_group_id ||
    !Array.isArray(req.recipients) ||
    req.recipients.length === 0 ||
    !req.subject ||
    !req.sent_at
  ) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error:
          "Missing required fields: email_group_id, recipients, subject, sent_at",
      }),
    };
  }

  for (const r of req.recipients) {
    if (!r.email || typeof r.email !== "string" || r.email.trim() === "") {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Each recipient must have a non-empty email field",
        }),
      };
    }
    if (
      !r.pixel_id ||
      typeof r.pixel_id !== "string" ||
      r.pixel_id.trim() === ""
    ) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Each recipient must have a non-empty pixel_id field",
        }),
      };
    }
  }

  await Promise.all(
    req.recipients.map((r) =>
      putRecord({
        pixel_id: r.pixel_id,
        email_group_id: req.email_group_id as string,
        recipient: r.email,
        subject: req.subject as string,
        sent_at: req.sent_at as string,
        opens: [],
      })
    )
  );

  return {
    statusCode: 201,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ created: req.recipients.length }),
  };
}
