import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmailTrackingRecord } from "@mailtrack/shared";

// REVIEW: mocking core dependency — test may not reflect real behavior
const mockSend = vi.fn();
vi.mock("@aws-sdk/lib-dynamodb", () => {
  return {
    DynamoDBDocumentClient: {
      from: vi.fn(() => ({ send: mockSend })),
    },
    PutCommand: vi.fn((input) => ({ input, _tag: "PutCommand" })),
    GetCommand: vi.fn((input) => ({ input, _tag: "GetCommand" })),
    ScanCommand: vi.fn((input) => ({ input, _tag: "ScanCommand" })),
    UpdateCommand: vi.fn((input) => ({ input, _tag: "UpdateCommand" })),
  };
});

vi.mock("@aws-sdk/client-dynamodb", () => {
  return {
    DynamoDBClient: vi.fn(() => ({})),
  };
});

describe("db helpers", () => {
  beforeEach(() => {
    mockSend.mockReset();
    process.env["TABLE_NAME"] = "email-tracking-test";
  });

  it("putRecord sends a PutCommand with the correct TableName and item", async () => {
    /**
     * Verifies that putRecord() calls DynamoDB PutCommand with the right table
     * name and the full tracking record as the Item.
     *
     * This matters because an incorrect TableName silently writes to the wrong
     * table (or throws a ResourceNotFoundException in prod). If the Item is
     * missing fields, DynamoDB stores incomplete records that break GET /emails.
     *
     * If this contract breaks, tracking records are not persisted and GET
     * /emails returns empty or incomplete data.
     */
    mockSend.mockResolvedValueOnce({});
    const { putRecord } = await import("../db.js");

    const record: EmailTrackingRecord = {
      pixel_id: "px-1",
      email_group_id: "grp-1",
      recipient: "test@example.com",
      subject: "Hello",
      sent_at: "2024-01-01T00:00:00Z",
      opens: [],
    };

    await putRecord(record);

    expect(mockSend).toHaveBeenCalledOnce();
    const cmd = mockSend.mock.calls[0][0] as { input: unknown };
    expect((cmd.input as { TableName: string }).TableName).toBe(
      "email-tracking-test"
    );
    expect((cmd.input as { Item: unknown }).Item).toMatchObject(record);
  });

  it("getRecord sends a GetCommand and returns the Item", async () => {
    /**
     * Verifies that getRecord() sends a GetCommand keyed on pixel_id and
     * returns the unmarshaled item from DynamoDB's response.
     *
     * This matters because the email tracking route must retrieve existing
     * records to append open events. If the wrong key is used or the return
     * value is not extracted, the update logic operates on undefined data and
     * corrupts the record.
     *
     * If this contract breaks, GET /emailTrack/{pixelId} appends opens to
     * undefined, causing runtime errors and lost open history.
     */
    const existingRecord: EmailTrackingRecord = {
      pixel_id: "px-2",
      email_group_id: "grp-2",
      recipient: "someone@example.com",
      subject: "Test",
      sent_at: "2024-01-02T00:00:00Z",
      opens: [],
    };
    mockSend.mockResolvedValueOnce({ Item: existingRecord });
    vi.resetModules();
    const { getRecord } = await import("../db.js");

    const result = await getRecord("px-2");
    expect(result).toEqual(existingRecord);
  });

  it("getRecord returns undefined when item does not exist", async () => {
    /**
     * Verifies that getRecord() returns undefined (not throws) when DynamoDB
     * returns no Item for the given pixel_id.
     *
     * This matters because a missing record is a normal condition: a pixel
     * could be fetched for a pixel_id that was never registered (or a test
     * request). The caller must be able to distinguish "found" vs "not found"
     * without catching exceptions.
     *
     * If this contract breaks, the emailTrack route crashes on first open of
     * any valid pixel, logging a spurious error and failing to return the PNG.
     */
    mockSend.mockResolvedValueOnce({});
    vi.resetModules();
    const { getRecord } = await import("../db.js");

    const result = await getRecord("nonexistent");
    expect(result).toBeUndefined();
  });

  it("scanRecords sends a ScanCommand and returns all Items", async () => {
    /**
     * Verifies that scanRecords() executes a full-table scan and returns the
     * Items array from the DynamoDB response.
     *
     * This matters because GET /emails relies on a scan to return all tracked
     * emails. If the Items field is not correctly extracted, the endpoint
     * returns undefined or throws instead of the email list.
     *
     * If this contract breaks, GET /emails always returns an empty array or 500,
     * making the tracking dashboard non-functional.
     */
    const items: EmailTrackingRecord[] = [
      {
        pixel_id: "px-10",
        email_group_id: "g",
        recipient: "a@b.com",
        subject: "S",
        sent_at: "2024-01-01T00:00:00Z",
        opens: [],
      },
    ];
    mockSend.mockResolvedValueOnce({ Items: items });
    vi.resetModules();
    const { scanRecords } = await import("../db.js");

    const result = await scanRecords();
    expect(result).toEqual(items);
  });

  it("updateOpens sends an UpdateCommand appending to the opens list", async () => {
    /**
     * Verifies that updateOpens() calls DynamoDB with an update expression
     * that appends the new OpenEvent to the existing opens list.
     *
     * This matters because the tracking pixel endpoint must atomically append
     * opens, not overwrite them. If the update expression is wrong, previous
     * open events are lost and the user sees incorrect open counts.
     *
     * If this contract breaks, each email shows at most one open event
     * regardless of how many times it was actually opened.
     */
    mockSend.mockResolvedValueOnce({});
    vi.resetModules();
    const { updateOpens } = await import("../db.js");

    const openEvent = {
      timestamp: "2024-06-01T12:00:00Z",
      ip: "1.2.3.4",
      user_agent: "Mozilla/5.0",
    };

    await updateOpens("px-5", openEvent);
    expect(mockSend).toHaveBeenCalledOnce();

    const cmd = mockSend.mock.calls[0][0] as { input: Record<string, unknown> };
    const input = cmd.input;

    // Verify UpdateExpression uses list_append for atomic append semantics
    expect(typeof input["UpdateExpression"]).toBe("string");
    expect(input["UpdateExpression"] as string).toContain("list_append");

    // Verify Key contains the pixel_id so the correct record is updated
    expect(input["Key"]).toMatchObject({ pixel_id: "px-5" });

    // Verify ExpressionAttributeValues contains the OpenEvent data
    const eav = input["ExpressionAttributeValues"] as Record<string, unknown>;
    const newOpenValues = Object.values(eav).find(
      (v) => Array.isArray(v) && (v as unknown[]).length > 0
    ) as unknown[] | undefined;
    expect(newOpenValues).toBeDefined();
    expect(newOpenValues?.[0]).toMatchObject({
      timestamp: "2024-06-01T12:00:00Z",
      ip: "1.2.3.4",
      user_agent: "Mozilla/5.0",
    });
  });

  it("scanRecords paginates using LastEvaluatedKey to collect all items across pages", async () => {
    /**
     * Verifies that scanRecords() continues scanning with ExclusiveStartKey
     * when DynamoDB returns a LastEvaluatedKey, accumulating all items across
     * multiple pages rather than returning only the first 1MB page.
     *
     * This matters because DynamoDB Scan returns at most 1MB per call. Without
     * pagination, large tables are silently truncated and GET /emails returns an
     * incomplete list, hiding tracked emails from the dashboard.
     *
     * If this contract breaks, the dashboard silently shows a subset of tracked
     * emails and users believe emails haven't been opened when they have.
     */
    const page1Items: EmailTrackingRecord[] = [
      {
        pixel_id: "px-page1",
        email_group_id: "g",
        recipient: "a@b.com",
        subject: "S",
        sent_at: "2024-01-01T00:00:00Z",
        opens: [],
      },
    ];
    const page2Items: EmailTrackingRecord[] = [
      {
        pixel_id: "px-page2",
        email_group_id: "g",
        recipient: "c@d.com",
        subject: "S",
        sent_at: "2024-01-02T00:00:00Z",
        opens: [],
      },
    ];

    // First call returns page 1 with a LastEvaluatedKey indicating more pages exist
    mockSend.mockResolvedValueOnce({
      Items: page1Items,
      LastEvaluatedKey: { pixel_id: "px-page1" },
    });
    // Second call returns page 2 with no LastEvaluatedKey — scan complete
    mockSend.mockResolvedValueOnce({ Items: page2Items });

    vi.resetModules();
    const { scanRecords } = await import("../db.js");
    const result = await scanRecords();

    // Both pages must be accumulated
    expect(result).toHaveLength(2);
    expect(result).toEqual([...page1Items, ...page2Items]);
    // Must have issued two separate Scan calls
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("throws when TABLE_NAME env var is missing", async () => {
    /**
     * Verifies that db operations throw a descriptive error when TABLE_NAME
     * is not set, rather than operating against an undefined table name.
     *
     * This matters because an undefined TABLE_NAME causes DynamoDB to throw
     * a validation error with a confusing message. Failing early and loudly
     * at the db module level surfaces deployment misconfigurations immediately.
     *
     * If this contract breaks, the Lambda fails with an opaque AWS error
     * instead of a clear "missing TABLE_NAME" message.
     */
    delete process.env["TABLE_NAME"];
    vi.resetModules();
    const { putRecord } = await import("../db.js");

    const record: EmailTrackingRecord = {
      pixel_id: "px-err",
      email_group_id: "g",
      recipient: "x@y.com",
      subject: "S",
      sent_at: "2024-01-01T00:00:00Z",
      opens: [],
    };

    await expect(putRecord(record)).rejects.toThrow(/TABLE_NAME/);
  });
});
