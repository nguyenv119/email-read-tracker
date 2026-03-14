import { describe, it, expect } from "vitest";
import type {
  CreateEmailRequest,
  EmailMetadata,
  OpenEvent,
  EmailTrackingRecord,
} from "../types.js";

// ---------------------------------------------------------------------------
// CreateEmailRequest
// ---------------------------------------------------------------------------

describe("CreateEmailRequest", () => {
  it("accepts valid shape", () => {
    /**
     * Verifies the POST /emails request body shape. If fields are missing or
     * mis-typed, the Lambda will write incomplete records or reject valid sends.
     * The recipients array must carry both email and pixel_id — losing pixel_id
     * means the backend has no key to look up opens against.
     */
    const req: CreateEmailRequest = {
      email_group_id: "grp_xyz",
      recipients: [
        { email: "alice@example.com", pixel_id: "px_001" },
        { email: "bob@example.com", pixel_id: "px_002" },
      ],
      subject: "Campaign launch",
      sent_at: "2026-03-13T08:00:00Z",
    };
    expect(req.recipients).toHaveLength(2);
  });

  it("rejects missing email_group_id", () => {
    /**
     * Without email_group_id, opens from different recipients can't be
     * grouped back into the same email thread in the UI.
     */
    // @ts-expect-error — email_group_id is required
    const req: CreateEmailRequest = {
      recipients: [{ email: "a@b.com", pixel_id: "px_1" }],
      subject: "Hi",
      sent_at: "2026-03-13T08:00:00Z",
    };
    void req;
  });

  it("rejects recipient missing pixel_id", () => {
    /**
     * Each recipient needs its own pixel_id — without it the backend has no
     * key to store or look up that recipient's open events.
     */
    const req: CreateEmailRequest = {
      email_group_id: "grp_xyz",
      // @ts-expect-error — pixel_id is required on each recipient
      recipients: [{ email: "a@b.com" }],
      subject: "Hi",
      sent_at: "2026-03-13T08:00:00Z",
    };
    void req;
  });
});

// ---------------------------------------------------------------------------
// EmailMetadata
// ---------------------------------------------------------------------------

describe("EmailMetadata", () => {
  it("accepts valid shape", () => {
    /**
     * pixel_id is the DynamoDB PK — if its type drifts, put/get calls use the
     * wrong key schema and open events are written to unreachable records.
     */
    const meta: EmailMetadata = {
      pixel_id: "px_abc123",
      email_group_id: "grp_xyz",
      recipient: "user@example.com",
      subject: "Hello!",
      sent_at: "2026-03-13T00:00:00Z",
    };
    expect(meta.pixel_id).toBe("px_abc123");
  });

  it("rejects missing pixel_id", () => {
    /**
     * A record without pixel_id can never be looked up when the tracking pixel
     * fires — the open event would be silently dropped.
     */
    // @ts-expect-error — pixel_id is required (DynamoDB PK)
    const meta: EmailMetadata = {
      email_group_id: "grp_xyz",
      recipient: "user@example.com",
      subject: "Hello!",
      sent_at: "2026-03-13T00:00:00Z",
    };
    void meta;
  });
});

// ---------------------------------------------------------------------------
// OpenEvent
// ---------------------------------------------------------------------------

describe("OpenEvent", () => {
  it("accepts valid shape", () => {
    /**
     * These three fields are appended on every pixel load. Missing ip or
     * user_agent means tracking data is lost and can't be recovered from
     * DynamoDB after the fact.
     */
    const ev: OpenEvent = {
      timestamp: "2026-03-13T12:00:00Z",
      ip: "1.2.3.4",
      user_agent: "Mozilla/5.0",
    };
    expect(ev.ip).toBe("1.2.3.4");
  });

  it("rejects missing user_agent", () => {
    /**
     * user_agent is used to detect Apple Mail prefetching (false-positive
     * suppression) — silently dropping it would corrupt open analytics.
     */
    // @ts-expect-error — user_agent is required
    const ev: OpenEvent = {
      timestamp: "2026-03-13T12:00:00Z",
      ip: "1.2.3.4",
    };
    expect(ev).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// EmailTrackingRecord
// ---------------------------------------------------------------------------

describe("EmailTrackingRecord", () => {
  it("accepts valid shape with opens", () => {
    /**
     * GET /emails returns EmailTrackingRecord[]. If opens is missing or
     * mis-typed the extension dashboard will fail to render the open list.
     */
    const record: EmailTrackingRecord = {
      pixel_id: "px_abc123",
      email_group_id: "grp_xyz",
      recipient: "user@example.com",
      subject: "Hello!",
      sent_at: "2026-03-13T00:00:00Z",
      opens: [{ timestamp: "2026-03-13T12:00:00Z", ip: "1.2.3.4", user_agent: "Mozilla/5.0" }],
    };
    expect(record.opens).toHaveLength(1);
  });

  it("accepts empty opens for unseen emails", () => {
    /**
     * Newly sent emails have no opens yet — if an empty array is rejected,
     * the extension would hide untracked emails from the sent view entirely.
     */
    const record: EmailTrackingRecord = {
      pixel_id: "px_new",
      email_group_id: "grp_new",
      recipient: "new@example.com",
      subject: "New email",
      sent_at: "2026-03-13T09:00:00Z",
      opens: [],
    };
    expect(record.opens).toHaveLength(0);
  });

  it("rejects missing opens field", () => {
    /**
     * Without opens, callers expecting an array crash at runtime when they
     * try to iterate or check length — there's no safe default to fall back to.
     */
    // @ts-expect-error — opens is required
    const record: EmailTrackingRecord = {
      pixel_id: "px_abc123",
      email_group_id: "grp_xyz",
      recipient: "user@example.com",
      subject: "Hello!",
      sent_at: "2026-03-13T00:00:00Z",
    };
    expect(record).toBeDefined();
  });
});
