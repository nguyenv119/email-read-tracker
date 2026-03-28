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

// ---------------------------------------------------------------------------
// Mock popup.js — so we can assert listener attachment on checkmarks
// ---------------------------------------------------------------------------
// REVIEW: mocking core dependency — test may not reflect real behavior

vi.mock("../ui/popup.js", () => ({
  showPopup: vi.fn(),
  hidePopup: vi.fn(),
}));

import { observeMessageList, rescanAllRows, CHECKMARK_ATTR, _resetObservingForTest } from "../ui/checkmarks.js";
import { showPopup } from "../ui/popup.js";
import { makeRecord } from "./helpers/factories.js";
import {
  setupMutationObserverStub,
  teardownMutationObserverStub,
  fireMutation,
} from "./helpers/mutation-observer.js";

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Gmail-style message row element with both the sender name
 * container (div.yW) and a subject span (span.bog), matching the real Gmail DOM.
 *
 * The sender cell contains div.yW (injection anchor) and the subject cell
 * contains span.bog (used only for tracking data lookup).
 */
function makeGmailRow(subject: string): HTMLElement {
  const row = document.createElement("tr");
  row.setAttribute("role", "row");

  // Sender name cell — div.yW is the injection anchor
  const senderCell = document.createElement("td");
  const senderDiv = document.createElement("div");
  senderDiv.className = "yW";
  const senderBa4 = document.createElement("span");
  senderBa4.className = "bA4";
  const senderName = document.createElement("span");
  senderName.className = "yP";
  senderName.setAttribute("email", "test@example.com");
  senderName.textContent = "Test Sender";
  senderBa4.appendChild(senderName);
  senderDiv.appendChild(senderBa4);
  senderCell.appendChild(senderDiv);
  row.appendChild(senderCell);

  // Subject cell — span.bog is the tracking data lookup selector
  const subjectCell = document.createElement("td");
  const subjectSpan = document.createElement("span");
  subjectSpan.className = "bog";
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
     * email with zero opens receives a ✓ (sent, not opened) checkmark span
     * with the mt-checkmark--tracked class (green).
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
    const checkmark = row.querySelector(`[${CHECKMARK_ATTR}]`) as HTMLElement;
    expect(checkmark).not.toBeNull();
    expect(checkmark.textContent).toContain("✓");
    expect(checkmark.textContent).not.toContain("✓✓");
    expect(checkmark.classList.contains("mt-checkmark--tracked")).toBe(true);
  });

  it("injects a double-checkmark span into a row with at least one open event", () => {
    /**
     * Verifies that a row whose subject matches a tracked email with at least
     * one open event receives a ✓✓ (opened) checkmark span with the
     * mt-checkmark--opened class (green).
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
    const checkmark = row.querySelector(`[${CHECKMARK_ATTR}]`) as HTMLElement;
    expect(checkmark).not.toBeNull();
    expect(checkmark.textContent).toContain("✓✓");
    expect(checkmark.classList.contains("mt-checkmark--opened")).toBe(true);
  });

  it("injects a gray single-checkmark on a row with no matching tracking records", () => {
    /**
     * Verifies that every Gmail message-list row receives a gray ✓ checkmark
     * even when that subject has no tracking data in the cache.
     *
     * Showing a gray checkmark on untracked rows makes the UI state legible:
     * users can see at a glance that some emails are tracked (green) and
     * others are not (gray), instead of seeing a mix of decorated and
     * undecorated rows.
     *
     * If this contract is violated, untracked rows show no checkmark at all,
     * making the tracking state invisible for the majority of inbox rows.
     */
    // GIVEN
    mockGetBySubject.mockReturnValue([]);
    observeMessageList();
    const row = makeGmailRow("Random Untracked Email");

    // WHEN
    fireMutation(row);

    // THEN — gray checkmark is injected
    const checkmark = row.querySelector(`[${CHECKMARK_ATTR}]`);
    expect(checkmark).not.toBeNull();
    expect(checkmark!.textContent).toBe("✓");
    expect((checkmark as HTMLElement).classList.contains("mt-checkmark--tracked")).toBe(false);
    expect((checkmark as HTMLElement).classList.contains("mt-checkmark--opened")).toBe(false);
  });

  it("injects a green tracked checkmark (mt-checkmark--tracked) on a row with a tracked but unopened email", () => {
    /**
     * Verifies that when tracking records exist for a subject but none have
     * opens, the injected checkmark carries the mt-checkmark--tracked CSS class
     * (rendered green) rather than the base gray class.
     *
     * The green color distinguishes tracked emails from untracked ones so users
     * can see which emails are being monitored at a glance.
     *
     * If this contract is violated, tracked-but-unread emails appear in the
     * same gray as untracked emails, making them indistinguishable.
     */
    // GIVEN
    mockGetBySubject.mockReturnValue([makeRecord({ opens: [] })]);
    observeMessageList();
    const row = makeGmailRow("Hello Tracked");

    // WHEN
    fireMutation(row);

    // THEN
    const checkmark = row.querySelector(`[${CHECKMARK_ATTR}]`) as HTMLElement;
    expect(checkmark).not.toBeNull();
    expect(checkmark.textContent).toBe("✓");
    expect(checkmark.classList.contains("mt-checkmark--tracked")).toBe(true);
    expect(checkmark.classList.contains("mt-checkmark--opened")).toBe(false);
  });

  it("injects a green opened checkmark (mt-checkmark--opened) on a row with open events", () => {
    /**
     * Verifies that when tracking records for a subject include open events,
     * the injected checkmark carries the mt-checkmark--opened CSS class (green)
     * and shows ✓✓.
     *
     * The double-check with green color is the primary signal users care about —
     * it confirms the recipient read the email.
     *
     * If this contract is violated, opened emails show only a single gray
     * checkmark, and users lose the read-receipt signal entirely.
     */
    // GIVEN
    const opened = makeRecord({
      opens: [{ timestamp: "2024-01-02T00:00:00Z", ip: "1.2.3.4", user_agent: "Mozilla" }],
    });
    mockGetBySubject.mockReturnValue([opened]);
    observeMessageList();
    const row = makeGmailRow("Hello Opened");

    // WHEN
    fireMutation(row);

    // THEN
    const checkmark = row.querySelector(`[${CHECKMARK_ATTR}]`) as HTMLElement;
    expect(checkmark).not.toBeNull();
    expect(checkmark.textContent).toBe("✓✓");
    expect(checkmark.classList.contains("mt-checkmark--opened")).toBe(true);
  });

  it("upgrades a gray checkmark to green when tracking data appears for the subject", () => {
    /**
     * Verifies that a row initially decorated with a gray ✓ (no tracking data)
     * is upgraded to a green ✓ (mt-checkmark--tracked) when the cache is
     * subsequently populated with tracking records for the same subject.
     *
     * This upgrade path is critical: users may load Gmail before the first poll
     * returns. Without the upgrade, rows stay gray forever even after the poll
     * populates the cache.
     *
     * If this contract is violated, rows are frozen in the gray state and never
     * show the user that their email is being tracked.
     */
    // GIVEN — first mutation shows no records (gray ✓)
    mockGetBySubject.mockReturnValue([]);
    observeMessageList();
    const row = makeGmailRow("Hello World");
    fireMutation(row);
    const checkmark = row.querySelector(`[${CHECKMARK_ATTR}]`) as HTMLElement;
    expect(checkmark.classList.contains("mt-checkmark--tracked")).toBe(false);

    // WHEN — cache now has a tracked record; fire mutation again
    mockGetBySubject.mockReturnValue([makeRecord({ opens: [] })]);
    fireMutation(row);

    // THEN — same span updated to green tracked, still only one span
    const checkmarks = row.querySelectorAll(`[${CHECKMARK_ATTR}]`);
    expect(checkmarks).toHaveLength(1);
    expect((checkmarks[0] as HTMLElement).classList.contains("mt-checkmark--tracked")).toBe(true);
    expect(checkmarks[0].textContent).toBe("✓");
  });

  it("does not attach popup hover listeners on a gray (untracked) checkmark", () => {
    /**
     * Verifies that gray checkmarks on untracked rows do not have popup
     * mouseenter/mouseleave listeners — hovering over them does nothing.
     *
     * A popup on an untracked row would be empty and misleading. Only
     * tracked and opened rows have meaningful tracking data to display.
     *
     * If this contract is violated, hovering any inbox row (even for personal
     * sent emails with no tracking) shows an empty popup, confusing users.
     */
    // GIVEN
    vi.mocked(showPopup).mockClear();
    mockGetBySubject.mockReturnValue([]);
    observeMessageList();
    const row = makeGmailRow("Untracked Subject");
    fireMutation(row);
    const checkmark = row.querySelector(`[${CHECKMARK_ATTR}]`) as HTMLElement;
    expect(checkmark).not.toBeNull();

    // WHEN — simulate mouseenter on the gray checkmark
    const enterEvent = new MouseEvent("mouseenter", { bubbles: true });
    checkmark.dispatchEvent(enterEvent);

    // THEN — showPopup was NOT called
    expect(showPopup).not.toHaveBeenCalled();
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

  it("injects checkmark after div.yW (sender name container), not after span.bog (subject)", () => {
    /**
     * Verifies that the checkmark span is placed immediately after the
     * div.yW sender-name container, not after the span.bog subject element.
     *
     * The task requires checkmarks to appear next to the sender name, not the
     * subject line. The visual placement anchor is div.yW; span.bog is only
     * used to look up tracking data by subject.
     *
     * If this contract is violated, the checkmark appears next to the subject
     * text (old behavior) instead of next to the sender name, breaking the
     * intended UX layout.
     */
    // GIVEN
    mockGetBySubject.mockReturnValue([makeRecord({ opens: [] })]);
    observeMessageList();
    const row = makeGmailRow("Hello World");

    // WHEN
    fireMutation(row);

    // THEN — checkmark is the next sibling of div.yW (the sender container)
    const senderDiv = row.querySelector("div.yW") as HTMLElement;
    expect(senderDiv).not.toBeNull();
    const checkmark = senderDiv.nextElementSibling as HTMLElement;
    expect(checkmark).not.toBeNull();
    expect(checkmark.getAttribute(CHECKMARK_ATTR)).toBe("true");

    // AND — span.bog is NOT immediately followed by the checkmark
    const subjectSpan = row.querySelector("span.bog") as HTMLElement;
    expect(subjectSpan).not.toBeNull();
    expect(subjectSpan.nextElementSibling?.getAttribute(CHECKMARK_ATTR)).not.toBe("true");
  });

  it("rescanAllRows injects checkmarks on rows already in the DOM when called", () => {
    /**
     * Verifies that rescanAllRows() processes all tr[role="row"] elements
     * currently in document.body and injects checkmarks, without requiring a
     * DOM mutation.
     *
     * content.ts passes rescanAllRows to startPolling as the onUpdate callback.
     * This ensures rows rendered before the first poll completes are decorated
     * as soon as tracking data arrives, rather than waiting for the next DOM
     * mutation event.
     *
     * If this contract is violated, rows present at page load show no checkmarks
     * until a new Gmail row is added to the DOM (which may never happen in a
     * static inbox view).
     */
    // GIVEN — rows are in the DOM before rescanAllRows is called
    mockGetBySubject.mockReturnValue([makeRecord({ opens: [] })]);
    const row = makeGmailRow("Pre-existing Row");
    // Do NOT call observeMessageList or fireMutation — rows are already in DOM

    // WHEN
    rescanAllRows();

    // THEN — checkmark is injected on the pre-existing row
    const checkmark = row.querySelector(`[${CHECKMARK_ATTR}]`) as HTMLElement;
    expect(checkmark).not.toBeNull();
    expect(checkmark.classList.contains("mt-checkmark--tracked")).toBe(true);
  });
});
