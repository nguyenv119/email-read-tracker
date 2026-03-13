/**
 * Structural type tests for @mailtrack/shared types.
 *
 * These tests verify the shape contracts of every exported interface. They use
 * TypeScript's structural typing: if an interface is missing a required field or
 * has the wrong field type, the assignment in the test will produce a compile
 * error, which causes `tsc --noEmit` (and vitest) to fail.
 *
 * Why this matters: backend and extension both import these types. If the shapes
 * drift the two consumers silently diverge — the backend stores fields the
 * extension never sees, or vice-versa — causing silent data loss.
 */

import { describe, it, expect } from "vitest";
import type {
  EmailMetadata,
  OpenEvent,
  CreateEmailRequest,
  EmailTrackingRecord,
} from "../types.js";

// ---------------------------------------------------------------------------
// EmailMetadata
// ---------------------------------------------------------------------------

describe("EmailMetadata", () => {
  it("accepts an object with all required fields set to the correct types", () => {
    /**
     * Verifies that EmailMetadata requires exactly pixel_id, email_group_id,
     * recipient, subject, and sent_at as strings.
     *
     * This matters because pixel_id is the primary lookup key for tracking
     * events; if its type is wrong the DynamoDB put/get calls use incorrect
     * key schemas.
     *
     * If this contract breaks, a caller constructing EmailMetadata will silently
     * omit a required field and the Lambda will write an incomplete record.
     */
    const meta: EmailMetadata = {
      pixel_id: "px_abc123",
      email_group_id: "grp_xyz",
      recipient: "user@example.com",
      subject: "Hello!",
      sent_at: "2026-03-13T00:00:00Z",
    };
    expect(meta.pixel_id).toBe("px_abc123");
    expect(meta.email_group_id).toBe("grp_xyz");
    expect(meta.recipient).toBe("user@example.com");
    expect(meta.subject).toBe("Hello!");
    expect(meta.sent_at).toBe("2026-03-13T00:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// OpenEvent
// ---------------------------------------------------------------------------

describe("OpenEvent", () => {
  it("accepts an object with timestamp, ip, and user_agent strings", () => {
    /**
     * Verifies that OpenEvent has exactly timestamp, ip, and user_agent.
     *
     * These three fields are appended to the opens array on every pixel load.
     * Missing ip or user_agent means we lose tracking data that can't be
     * retroactively recovered from DynamoDB.
     *
     * If this contract breaks, open events written by the Lambda will be
     * missing fields, causing the extension dashboard to show empty metadata
     * for opens.
     */
    const ev: OpenEvent = {
      timestamp: "2026-03-13T12:00:00Z",
      ip: "1.2.3.4",
      user_agent: "Mozilla/5.0",
    };
    expect(ev.timestamp).toBe("2026-03-13T12:00:00Z");
    expect(ev.ip).toBe("1.2.3.4");
    expect(ev.user_agent).toBe("Mozilla/5.0");
  });
});

// ---------------------------------------------------------------------------
// CreateEmailRequest
// ---------------------------------------------------------------------------

describe("CreateEmailRequest", () => {
  it("accepts an object with email_group_id, recipients array, subject, and sent_at", () => {
    /**
     * Verifies that CreateEmailRequest has email_group_id, subject, sent_at
     * strings plus a recipients array of { email, pixel_id } objects.
     *
     * This is the POST /emails request body. If the shape is wrong, the Lambda
     * will fail to validate incoming requests and either write bad data to
     * DynamoDB or reject valid requests.
     *
     * If this contract breaks, the extension will send a request that the
     * backend rejects or misinterprets, silently dropping recipients.
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
    expect(req.email_group_id).toBe("grp_xyz");
    expect(req.recipients).toHaveLength(2);
    expect(req.recipients[0].email).toBe("alice@example.com");
    expect(req.recipients[0].pixel_id).toBe("px_001");
    expect(req.subject).toBe("Campaign launch");
    expect(req.sent_at).toBe("2026-03-13T08:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// EmailTrackingRecord
// ---------------------------------------------------------------------------

describe("EmailTrackingRecord", () => {
  it("is a superset of EmailMetadata with an opens array of OpenEvent", () => {
    /**
     * Verifies that EmailTrackingRecord extends EmailMetadata and adds an
     * opens field typed as OpenEvent[].
     *
     * This matters because GET /emails returns EmailTrackingRecord[]. If opens
     * is missing or mis-typed the extension dashboard will fail to render the
     * open count and event list.
     *
     * If this contract breaks, callers expecting opens to be an array will
     * receive undefined and crash at runtime.
     */
    const record: EmailTrackingRecord = {
      pixel_id: "px_abc123",
      email_group_id: "grp_xyz",
      recipient: "user@example.com",
      subject: "Hello!",
      sent_at: "2026-03-13T00:00:00Z",
      opens: [
        {
          timestamp: "2026-03-13T12:00:00Z",
          ip: "1.2.3.4",
          user_agent: "Mozilla/5.0",
        },
      ],
    };
    expect(record.opens).toHaveLength(1);
    expect(record.opens[0].ip).toBe("1.2.3.4");
    // Verify EmailMetadata fields are still present
    expect(record.pixel_id).toBe("px_abc123");
  });

  it("allows an empty opens array for newly sent emails with no views yet", () => {
    /**
     * Verifies that EmailTrackingRecord.opens can be an empty array.
     *
     * A newly created tracking record has no opens. If an empty array is not
     * allowed, newly created records would be invalid and the extension would
     * fail to display unseen emails.
     *
     * If this contract breaks, the backend would need to omit records with no
     * opens from GET /emails, hiding unread emails from the user.
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
});
