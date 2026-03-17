import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock poll.ts — checkmarks.ts's data dependency
// Must use vi.hoisted so the mock factory can reference the spy variable,
// since vi.mock factories are hoisted before any import statements.
// ---------------------------------------------------------------------------
// REVIEW: mocking core dependency — test may not reflect real behavior

const { mockGetBySubject } = vi.hoisted(() => ({
  mockGetBySubject: vi.fn(),
}));

vi.mock("../ui/poll.js", () => ({
  getBySubject: mockGetBySubject,
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  getCache: vi.fn(() => new Map()),
  clearCache: vi.fn(),
}));

import type { EmailTrackingRecord } from "../../../shared/src/types.js";
import { observeMessageList, CHECKMARK_ATTR } from "../ui/checkmarks.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<EmailTrackingRecord> = {}): EmailTrackingRecord {
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

/** Build a minimal Gmail-style message row element with a subject span. */
function makeGmailRow(subject: string): HTMLElement {
  const row = document.createElement("tr");
  row.setAttribute("role", "row");
  const subjectCell = document.createElement("td");
  const subjectSpan = document.createElement("span");
  subjectSpan.className = "bog"; // Gmail's subject span class
  subjectSpan.textContent = subject;
  subjectCell.appendChild(subjectSpan);
  row.appendChild(subjectCell);
  document.body.appendChild(row);
  return row;
}

// ---------------------------------------------------------------------------
// MutationObserver stub helpers
// ---------------------------------------------------------------------------

let capturedCallback: MutationCallback | null = null;
let OriginalMO: typeof MutationObserver;

function setupMutationObserverStub(): void {
  capturedCallback = null;
  OriginalMO = window.MutationObserver;
  vi.stubGlobal(
    "MutationObserver",
    vi.fn(function (this: MutationObserver, cb: MutationCallback) {
      capturedCallback = cb;
      this.observe = vi.fn();
      this.disconnect = vi.fn();
      this.takeRecords = () => [];
    })
  );
}

function teardownMutationObserverStub(): void {
  vi.stubGlobal("MutationObserver", OriginalMO);
}

function fireMutation(addedNode: Node): void {
  capturedCallback!(
    [
      {
        type: "childList",
        addedNodes: [addedNode] as unknown as NodeList,
        removedNodes: [] as unknown as NodeList,
        target: document.body,
        previousSibling: null,
        nextSibling: null,
        attributeName: null,
        attributeNamespace: null,
        oldValue: null,
      } satisfies MutationRecord,
    ],
    {} as MutationObserver
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkmarks.ts", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mockGetBySubject.mockReset();
    setupMutationObserverStub();
  });

  afterEach(() => {
    teardownMutationObserverStub();
  });

  it("injects a single-checkmark span into a row with a tracked but unopened subject", () => {
    /**
     * Verifies that a Gmail message-list row whose subject matches a tracked
     * email with zero opens receives a ✓ (sent, not opened) checkmark span.
     *
     * Without checkmark injection, users cannot distinguish tracked emails
     * from untracked ones in the list view.
     *
     * If this contract is violated, rows for unread tracked emails show no
     * checkmark even though the email was sent with a tracking pixel.
     */
    // GIVEN
    mockGetBySubject.mockReturnValue([makeRecord({ opens: [] })]);
    observeMessageList();
    const row = makeGmailRow("Hello World");

    // WHEN
    fireMutation(row);

    // THEN
    const checkmark = row.querySelector(`[${CHECKMARK_ATTR}]`);
    expect(checkmark).not.toBeNull();
    expect(checkmark!.textContent).toContain("✓");
    expect(checkmark!.textContent).not.toContain("✓✓");
  });

  it("injects a double-checkmark span into a row with at least one open event", () => {
    /**
     * Verifies that a row whose subject matches a tracked email with at least
     * one open event receives a ✓✓ (opened) checkmark span.
     *
     * The core value of the extension is confirming receipt; ✓✓ is the
     * signal users care about.
     *
     * If this contract is violated, users cannot tell whether their email was
     * opened, defeating the purpose of the extension.
     */
    // GIVEN
    const opened = makeRecord({
      opens: [{ timestamp: "2024-01-02T00:00:00Z", ip: "1.2.3.4", user_agent: "Mozilla" }],
    });
    mockGetBySubject.mockReturnValue([opened]);
    observeMessageList();
    const row = makeGmailRow("Hello World");

    // WHEN
    fireMutation(row);

    // THEN
    const checkmark = row.querySelector(`[${CHECKMARK_ATTR}]`);
    expect(checkmark).not.toBeNull();
    expect(checkmark!.textContent).toContain("✓✓");
  });

  it("does not inject a checkmark into a row with no matching tracking records", () => {
    /**
     * Verifies that rows for emails not in the tracking database receive no
     * injected checkmark span.
     *
     * Injecting spurious checkmarks on untracked emails would confuse users
     * into thinking all their emails are being tracked.
     *
     * If this contract is violated, every email row shows a checkmark
     * regardless of whether it was sent with a tracking pixel.
     */
    // GIVEN
    mockGetBySubject.mockReturnValue([]);
    observeMessageList();
    const row = makeGmailRow("Random Untracked Email");

    // WHEN
    fireMutation(row);

    // THEN
    const checkmark = row.querySelector(`[${CHECKMARK_ATTR}]`);
    expect(checkmark).toBeNull();
  });

  it("does not inject a duplicate checkmark if the row is mutated a second time", () => {
    /**
     * Verifies that re-processing a row that already has a checkmark does not
     * add a second one.
     *
     * Gmail's MutationObserver fires on many DOM changes; without a guard,
     * each mutation would append another checkmark to already-decorated rows.
     *
     * If this contract is violated, processed rows accumulate unbounded
     * checkmark spans, corrupting the Gmail UI.
     */
    // GIVEN
    mockGetBySubject.mockReturnValue([makeRecord({ opens: [] })]);
    observeMessageList();
    const row = makeGmailRow("Hello World");

    // WHEN — fire mutation twice
    fireMutation(row);
    fireMutation(row);

    // THEN — only one checkmark span
    const checkmarks = row.querySelectorAll(`[${CHECKMARK_ATTR}]`);
    expect(checkmarks).toHaveLength(1);
  });

  it("uses the most-open record when multiple records share the same subject", () => {
    /**
     * Verifies that when multiple per-recipient records share the same subject
     * (all recipients of one compose action), the row shows ✓✓ if any
     * recipient opened the email.
     *
     * A group email is "opened" if at least one recipient opened it. Showing
     * ✓ when one of two recipients already opened would mislead the sender.
     *
     * If this contract is violated, ✓✓ is only shown if the first matching
     * record has opens, silently missing reads by other recipients.
     */
    // GIVEN
    const unread = makeRecord({ pixel_id: "px-1", recipient: "a@example.com", opens: [] });
    const read = makeRecord({
      pixel_id: "px-2",
      recipient: "b@example.com",
      opens: [{ timestamp: "2024-01-02T00:00:00Z", ip: "1.2.3.4", user_agent: "Mozilla" }],
    });
    mockGetBySubject.mockReturnValue([unread, read]);
    observeMessageList();
    const row = makeGmailRow("Hello World");

    // WHEN
    fireMutation(row);

    // THEN — at least one open => ✓✓
    const checkmark = row.querySelector(`[${CHECKMARK_ATTR}]`);
    expect(checkmark!.textContent).toContain("✓✓");
  });
});
