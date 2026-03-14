import { scanRecords } from "../db.js";
import type { LambdaResponse } from "../types.js";

/**
 * GET /emails
 *
 * Scans the DynamoDB table and returns all EmailTrackingRecords as JSON.
 */
export async function getEmails(): Promise<LambdaResponse> {
  const records = await scanRecords();
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(records),
  };
}
