import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CreateEmailRequest, EmailTrackingRecord } from "@mailtrack/shared";

// REVIEW: mocking core dependency — test may not reflect real behavior
vi.mock("../db.js", () => ({
  putRecord: vi.fn(),
  getRecord: vi.fn(),
  scanRecords: vi.fn(),
  updateOpens: vi.fn(),
}));

vi.mock("../ntfy.js", () => ({
  notifyOpen: vi.fn(),
}));

vi.mock("../pixel.js", () => ({
  PIXEL_PNG: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  ),
}));

type LambdaUrlEvent = {
  rawPath: string;
  requestContext: { http: { method: string; sourceIp?: string } };
  headers?: Record<string, string>;
  body?: string | null;
  isBase64Encoded?: boolean;
};

async function callHandler(event: LambdaUrlEvent) {
  vi.resetModules();
  // Re-apply mocks after reset
  vi.mock("../db.js", () => ({
    putRecord: vi.fn(),
    getRecord: vi.fn(),
    scanRecords: vi.fn(),
    updateOpens: vi.fn(),
  }));
  vi.mock("../ntfy.js", () => ({
    notifyOpen: vi.fn(),
  }));
  vi.mock("../pixel.js", () => ({
    PIXEL_PNG: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    ),
  }));
  const { handler } = await import("../index.js");
  return handler(event);
}

describe("Lambda handler routing", () => {
  beforeEach(() => {
    process.env["TABLE_NAME"] = "test-table";
    process.env["NTFY_TOPIC"] = "test-topic";
    vi.clearAllMocks();
  });

  it("returns 404 for an unknown path", async () => {
    /**
     * Verifies that the router returns HTTP 404 for any path not matching the
     * three registered routes.
     *
     * This matters because unrecognised paths should never silently succeed —
     * returning 200 or 500 for unknown routes misleads callers and can mask
     * routing bugs (e.g., a mistyped path in the client).
     *
     * If this contract breaks, misspelled or malicious paths may accidentally
     * match a handler and return data or perform mutations.
     */
    const { handler } = await import("../index.js");
    const result = await handler({
      rawPath: "/unknown",
      requestContext: { http: { method: "GET" } },
    });
    expect(result.statusCode).toBe(404);
  });

  it("routes POST /emails to the postEmails handler and returns 201", async () => {
    /**
     * Verifies that POST /emails is dispatched to the correct handler and
     * returns HTTP 201 Created with the number of created records.
     *
     * This matters because the Chrome extension POSTs to this route to register
     * tracking pixels. A wrong status code or routing failure means no pixels
     * are registered and no tracking occurs.
     *
     * If this contract breaks, the extension silently fails to register emails
     * and users see no open events.
     */
    const db = await import("../db.js");
    vi.mocked(db.putRecord).mockResolvedValue(undefined);

    const body: CreateEmailRequest = {
      email_group_id: "grp-1",
      recipients: [{ email: "a@b.com", pixel_id: "px-1" }],
      subject: "Hello",
      sent_at: "2024-01-01T00:00:00Z",
    };

    const { handler } = await import("../index.js");
    const result = await handler({
      rawPath: "/emails",
      requestContext: { http: { method: "POST" } },
      body: JSON.stringify(body),
    });

    expect(result.statusCode).toBe(201);
    expect(db.putRecord).toHaveBeenCalledOnce();
  });

  it("POST /emails calls putRecord once per recipient", async () => {
    /**
     * Verifies that POST /emails creates one DynamoDB record per recipient,
     * not one record for the whole batch.
     *
     * This matters because each pixel_id must map to exactly one recipient.
     * If records are collapsed, multiple recipients share the same tracking
     * record and opens are attributed to the wrong person.
     *
     * If this contract breaks, a batch of N recipients produces only 1 DB
     * record and N-1 pixel_ids return 404 or incorrect data.
     */
    const db = await import("../db.js");
    vi.mocked(db.putRecord).mockResolvedValue(undefined);

    const body: CreateEmailRequest = {
      email_group_id: "grp-multi",
      recipients: [
        { email: "a@b.com", pixel_id: "px-a" },
        { email: "c@d.com", pixel_id: "px-c" },
        { email: "e@f.com", pixel_id: "px-e" },
      ],
      subject: "Multi",
      sent_at: "2024-01-01T00:00:00Z",
    };

    const { handler } = await import("../index.js");
    await handler({
      rawPath: "/emails",
      requestContext: { http: { method: "POST" } },
      body: JSON.stringify(body),
    });

    expect(db.putRecord).toHaveBeenCalledTimes(3);
  });

  it("GET /emails returns 200 with EmailTrackingRecord array", async () => {
    /**
     * Verifies that GET /emails returns HTTP 200 with a JSON array of
     * EmailTrackingRecord objects from DynamoDB.
     *
     * This matters because the tracking dashboard calls this endpoint to
     * display all tracked emails. A wrong status code or non-array body breaks
     * the UI rendering entirely.
     *
     * If this contract breaks, the dashboard shows an error instead of the
     * email list.
     */
    const db = await import("../db.js");
    const records: EmailTrackingRecord[] = [
      {
        pixel_id: "px-1",
        email_group_id: "g",
        recipient: "a@b.com",
        subject: "S",
        sent_at: "2024-01-01T00:00:00Z",
        opens: [],
      },
    ];
    vi.mocked(db.scanRecords).mockResolvedValue(records);

    const { handler } = await import("../index.js");
    const result = await handler({
      rawPath: "/emails",
      requestContext: { http: { method: "GET" } },
    });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? "")).toEqual(records);
  });

  it("GET /emailTrack/{pixelId} returns 200 with PNG content-type and no-cache headers", async () => {
    /**
     * Verifies that the tracking pixel endpoint responds with the correct
     * content-type (image/png) and cache-control headers (no-cache, no-store).
     *
     * This matters because email clients must not cache the tracking pixel —
     * every load must reach the server. If Cache-Control is missing or
     * permissive, the client caches the image and subsequent opens are not
     * counted, causing missed open events.
     *
     * If this contract breaks, email clients serve the pixel from cache and
     * the Lambda never records subsequent opens for the same email.
     */
    const db = await import("../db.js");
    const record: EmailTrackingRecord = {
      pixel_id: "px-track-1",
      email_group_id: "g",
      recipient: "track@test.com",
      subject: "Test",
      sent_at: "2024-01-01T00:00:00Z",
      opens: [],
    };
    vi.mocked(db.getRecord).mockResolvedValue(record);
    vi.mocked(db.updateOpens).mockResolvedValue(undefined);
    const ntfy = await import("../ntfy.js");
    vi.mocked(ntfy.notifyOpen).mockResolvedValue(undefined);

    const { handler } = await import("../index.js");
    const result = await handler({
      rawPath: "/emailTrack/px-track-1",
      requestContext: { http: { method: "GET", sourceIp: "10.0.0.1" } },
      headers: { "user-agent": "TestClient/1.0" },
    });

    expect(result.statusCode).toBe(200);
    expect(result.headers?.["Content-Type"]).toBe("image/png");
    const cc = result.headers?.["Cache-Control"] ?? "";
    expect(cc).toContain("no-cache");
    expect(cc).toContain("no-store");
    expect(result.isBase64Encoded).toBe(true);
  });

  it("GET /emailTrack/{pixelId} calls updateOpens and notifyOpen", async () => {
    /**
     * Verifies that visiting the tracking pixel triggers both an open event
     * update in DynamoDB and an ntfy.sh notification.
     *
     * This matters because these are the two side effects the entire tracking
     * system is built on. If either is skipped, the user either doesn't see
     * open events in the dashboard or doesn't receive real-time notifications.
     *
     * If this contract breaks, pixel loads are silently swallowed with no
     * record and no notification.
     */
    const db = await import("../db.js");
    const ntfy = await import("../ntfy.js");
    const record: EmailTrackingRecord = {
      pixel_id: "px-side-effects",
      email_group_id: "g",
      recipient: "side@test.com",
      subject: "SE",
      sent_at: "2024-01-01T00:00:00Z",
      opens: [],
    };
    vi.mocked(db.getRecord).mockResolvedValue(record);
    vi.mocked(db.updateOpens).mockResolvedValue(undefined);
    vi.mocked(ntfy.notifyOpen).mockResolvedValue(undefined);

    const { handler } = await import("../index.js");
    await handler({
      rawPath: "/emailTrack/px-side-effects",
      requestContext: { http: { method: "GET", sourceIp: "2.3.4.5" } },
      headers: {},
    });

    expect(db.updateOpens).toHaveBeenCalledOnce();
    expect(ntfy.notifyOpen).toHaveBeenCalledWith(
      "px-side-effects",
      "side@test.com"
    );
  });

  it("GET /emailTrack/{pixelId} still returns PNG when pixel_id not found in DB", async () => {
    /**
     * Verifies that the tracking pixel always returns the PNG even when the
     * pixel_id is not registered in DynamoDB (record not found).
     *
     * This matters because the email client must always receive a valid image
     * response regardless of the server's internal state. A 404 or 500 response
     * for an unregistered pixel causes the email client to show a broken image
     * icon, which can tip off the recipient that they are being tracked.
     *
     * If this contract breaks, unknown pixel_ids return an error response and
     * email clients may display broken images.
     */
    const db = await import("../db.js");
    vi.mocked(db.getRecord).mockResolvedValue(undefined);

    const { handler } = await import("../index.js");
    const result = await handler({
      rawPath: "/emailTrack/unknown-pixel",
      requestContext: { http: { method: "GET" } },
      headers: {},
    });

    expect(result.statusCode).toBe(200);
    expect(result.headers?.["Content-Type"]).toBe("image/png");
  });

  it("POST /emails returns 400 when body is missing required fields", async () => {
    /**
     * Verifies that POST /emails returns HTTP 400 when the request body is
     * missing required CreateEmailRequest fields (e.g., recipients is absent).
     *
     * This matters because writing an incomplete tracking record to DynamoDB
     * produces corrupted data that breaks GET /emails deserialization and open
     * event attribution.
     *
     * If this contract breaks, malformed requests silently persist corrupt
     * records to DynamoDB.
     */
    const { handler } = await import("../index.js");
    const result = await handler({
      rawPath: "/emails",
      requestContext: { http: { method: "POST" } },
      body: JSON.stringify({ email_group_id: "g" }), // missing recipients, subject, sent_at
    });

    expect(result.statusCode).toBe(400);
  });
});
