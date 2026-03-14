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
    // @ts-expect-error — email_group_id is required
    const req: CreateEmailRequest = {
      recipients: [{ email: "a@b.com", pixel_id: "px_1" }],
      subject: "Hi",
      sent_at: "2026-03-13T08:00:00Z",
    };
    expect(req).toBeDefined();
  });

  it("rejects recipient missing pixel_id", () => {
    const req: CreateEmailRequest = {
      email_group_id: "grp_xyz",
      // @ts-expect-error — pixel_id is required on each recipient
      recipients: [{ email: "a@b.com" }],
      subject: "Hi",
      sent_at: "2026-03-13T08:00:00Z",
    };
    expect(req).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// EmailMetadata
// ---------------------------------------------------------------------------

describe("EmailMetadata", () => {
  it("accepts valid shape", () => {
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
    // @ts-expect-error — pixel_id is required (DynamoDB PK)
    const meta: EmailMetadata = {
      email_group_id: "grp_xyz",
      recipient: "user@example.com",
      subject: "Hello!",
      sent_at: "2026-03-13T00:00:00Z",
    };
    expect(meta).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// OpenEvent
// ---------------------------------------------------------------------------

describe("OpenEvent", () => {
  it("accepts valid shape", () => {
    const ev: OpenEvent = {
      timestamp: "2026-03-13T12:00:00Z",
      ip: "1.2.3.4",
      user_agent: "Mozilla/5.0",
    };
    expect(ev.ip).toBe("1.2.3.4");
  });

  it("rejects missing user_agent", () => {
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
