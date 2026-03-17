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

import { observeMessageList, CHECKMARK_ATTR, _resetObservingForTest } from "../ui/checkmarks.js";
import { makeRecord } from "./helpers/factories.js";
import {
  setupMutationObserverStub,
  teardownMutationObserverStub,
  fireMutation,
} from "./helpers/mutation-observer.js";

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

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
// Tests
// ---------------------------------------------------------------------------

describe("checkmarks.ts", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mockGetBySubject.mockReset();
    _resetObservingForTest();
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

  it("upgrades a single-checkmark to double-checkmark when polling detects a new open", () => {
    /**
     * Verifies that a row already decorated with ✓ is upgraded to ✓✓ when
     * a subsequent poll returns an open event for the same subject.
     *
     * Without this upgrade, polling refreshes the cache but the UI never
     * reflects new opens — users see ✓ forever even after the recipient reads
     * the email.
     *
     * If this contract is violated, checkmarks are frozen at their initial
     * state and the "read" signal (✓✓) is never shown after page load.
     */
    // GIVEN — first mutation shows no opens (✓)
    mockGetBySubject.mockReturnValue([makeRecord({ opens: [] })]);
    observeMessageList();
    const row = makeGmailRow("Hello World");
    fireMutation(row);
    const checkmark = row.querySelector(`[${CHECKMARK_ATTR}]`)!;
    expect(checkmark.textContent).toBe("✓");

    // WHEN — cache now has an open; fire mutation again on the same row
    mockGetBySubject.mockReturnValue([
      makeRecord({
        opens: [{ timestamp: "2024-01-02T00:00:00Z", ip: "1.2.3.4", user_agent: "Mozilla" }],
      }),
    ]);
    fireMutation(row);

    // THEN — the existing checkmark is updated to ✓✓, still only one span
    const checkmarks = row.querySelectorAll(`[${CHECKMARK_ATTR}]`);
    expect(checkmarks).toHaveLength(1);
    expect(checkmarks[0].textContent).toBe("✓✓");
  });

  it("does not add a second MutationObserver when observeMessageList is called twice", () => {
    /**
     * Verifies that calling observeMessageList() more than once is a no-op —
     * only a single MutationObserver is ever created.
     *
     * Each extra observer fires on every DOM mutation, so N calls create N
     * redundant processing passes and N redundant checkmarks per row.
     *
     * If this contract is violated, content.ts accidentally calling
     * observeMessageList() twice causes every injection to run twice,
     * duplicating checkmarks and degrading Gmail performance.
     */
    // GIVEN
    observeMessageList();

    // WHEN — call again
    const MOSpy = vi.mocked(MutationObserver);
    const callsBefore = MOSpy.mock.calls.length;
    observeMessageList();

    // THEN — no additional MutationObserver was constructed
    expect(MOSpy.mock.calls.length).toBe(callsBefore);
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
