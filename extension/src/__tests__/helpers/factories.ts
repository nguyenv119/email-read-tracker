import type { EmailTrackingRecord } from "../../../../shared/src/types.js";

/**
 * Shared factory for EmailTrackingRecord test fixtures.
 *
 * Used across checkmarks, poll, and popup tests to avoid duplicating the
 * default record shape and to ensure all tests use a consistent baseline.
 */
export function makeRecord(overrides: Partial<EmailTrackingRecord> = {}): EmailTrackingRecord {
  return {
    pixel_id: "px-1",
    email_group_id: "grp-1",
    recipient: "a@example.com",
    subject: "Hello World",
    sent_at: "2024-01-01T00:00:00Z",
    opens: [],
    ...overrides,
  };
}
