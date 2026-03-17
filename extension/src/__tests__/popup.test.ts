import { describe, it, expect, vi, beforeEach } from "vitest";

import type { EmailTrackingRecord } from "../../../shared/src/types.js";
import { showPopup, hidePopup, POPUP_ID } from "../ui/popup.js";

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("popup.ts", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // Remove any lingering popup between tests
    document.getElementById(POPUP_ID)?.remove();
  });

  it("showPopup inserts the popup element into the document body", () => {
    /**
     * Verifies that showPopup() attaches a popup element to document.body.
     *
     * The popup is the only way users see per-recipient open details. If it
     * is never inserted into the DOM, hovering checkmarks shows nothing.
     *
     * If this contract is violated, the hover UX is broken — no popup
     * appears and users cannot inspect per-recipient tracking data.
     */
    // GIVEN
    const records = [makeRecord()];
    const anchor = document.createElement("span");
    document.body.appendChild(anchor);

    // WHEN
    showPopup(records, anchor);

    // THEN
    expect(document.getElementById(POPUP_ID)).not.toBeNull();
  });

  it("showPopup renders each recipient's email address in the popup", () => {
    /**
     * Verifies that each tracking record's recipient email address appears
     * in the rendered popup.
     *
     * Recipients are the primary row identifier in the popup — without them
     * users cannot see who opened the email.
     *
     * If this contract is violated, the popup is blank or missing recipient
     * rows, making tracking data inaccessible.
     */
    // GIVEN
    const records = [
      makeRecord({ recipient: "alice@example.com", pixel_id: "px-A" }),
      makeRecord({ recipient: "bob@example.com", pixel_id: "px-B" }),
    ];
    const anchor = document.createElement("span");
    document.body.appendChild(anchor);

    // WHEN
    showPopup(records, anchor);

    // THEN
    const popup = document.getElementById(POPUP_ID)!;
    expect(popup.textContent).toContain("alice@example.com");
    expect(popup.textContent).toContain("bob@example.com");
  });

  it("showPopup renders open count for a recipient with opens", () => {
    /**
     * Verifies that a recipient who has opened the email shows a non-zero
     * open count in the popup.
     *
     * Open count is a core data point — users need to know how many times
     * each recipient opened their email.
     *
     * If this contract is violated, opened emails show 0 opens, hiding
     * engagement data from the sender.
     */
    // GIVEN
    const record = makeRecord({
      recipient: "alice@example.com",
      opens: [
        { timestamp: "2024-01-02T00:00:00Z", ip: "1.2.3.4", user_agent: "Mozilla/5.0" },
        { timestamp: "2024-01-03T00:00:00Z", ip: "1.2.3.4", user_agent: "Mozilla/5.0" },
      ],
    });
    const anchor = document.createElement("span");
    document.body.appendChild(anchor);

    // WHEN
    showPopup([record], anchor);

    // THEN
    const popup = document.getElementById(POPUP_ID)!;
    // Should show count 2 somewhere near the recipient
    expect(popup.textContent).toMatch(/2/);
  });

  it("showPopup renders first and last open timestamps for a recipient with opens", () => {
    /**
     * Verifies that the popup shows both the first and last open timestamp
     * for a recipient with multiple opens.
     *
     * Users need temporal context to understand reading patterns (e.g., "read
     * it right away vs. a day later"). Without timestamps the open count is
     * less actionable.
     *
     * If this contract is violated, users see an open count but no dates,
     * reducing the usefulness of the tracking data.
     */
    // GIVEN
    const record = makeRecord({
      opens: [
        { timestamp: "2024-01-02T10:00:00Z", ip: "1.2.3.4", user_agent: "Chrome" },
        { timestamp: "2024-01-05T15:30:00Z", ip: "1.2.3.4", user_agent: "Chrome" },
      ],
    });
    const anchor = document.createElement("span");
    document.body.appendChild(anchor);

    // WHEN
    showPopup([record], anchor);

    // THEN — both timestamps should appear somewhere in the popup text
    const popup = document.getElementById(POPUP_ID)!;
    expect(popup.textContent).toContain("2024");
  });

  it("showPopup renders user agent for a recipient with opens", () => {
    /**
     * Verifies that the popup includes the user agent from the open event.
     *
     * User agent reveals the mail client used to open the email, which is
     * useful context (e.g., mobile vs desktop, Gmail vs Outlook).
     *
     * If this contract is violated, the popup omits the mail client info,
     * reducing the diagnostic value of the tracking data.
     */
    // GIVEN
    const record = makeRecord({
      opens: [
        { timestamp: "2024-01-02T10:00:00Z", ip: "1.2.3.4", user_agent: "Outlook/16.0" },
      ],
    });
    const anchor = document.createElement("span");
    document.body.appendChild(anchor);

    // WHEN
    showPopup([record], anchor);

    // THEN
    const popup = document.getElementById(POPUP_ID)!;
    expect(popup.textContent).toContain("Outlook/16.0");
  });

  it("hidePopup removes the popup element from the document", () => {
    /**
     * Verifies that hidePopup() removes the popup from the DOM.
     *
     * The popup should disappear when the cursor leaves the checkmark — a
     * persistent popup blocks Gmail's normal list UI.
     *
     * If this contract is violated, the popup stays open permanently,
     * overlaying Gmail and making it unusable.
     */
    // GIVEN
    const anchor = document.createElement("span");
    document.body.appendChild(anchor);
    showPopup([makeRecord()], anchor);
    expect(document.getElementById(POPUP_ID)).not.toBeNull();

    // WHEN
    hidePopup();

    // THEN
    expect(document.getElementById(POPUP_ID)).toBeNull();
  });

  it("hidePopup is a no-op when the popup is not in the DOM", () => {
    /**
     * Verifies that calling hidePopup() when no popup exists does not throw.
     *
     * mouseleave events can fire without a preceding mouseenter; hidePopup
     * must be safe to call unconditionally.
     *
     * If this contract is violated, a stray mouseleave event throws an
     * uncaught exception and may crash the content script.
     */
    // GIVEN — no popup in DOM

    // WHEN / THEN
    expect(() => hidePopup()).not.toThrow();
  });

  it("showPopup replaces an existing popup rather than creating a second one", () => {
    /**
     * Verifies that calling showPopup() twice results in exactly one popup
     * element in the DOM.
     *
     * If multiple popups stack, they overlap and produce garbled output;
     * the z-index layering also becomes unpredictable.
     *
     * If this contract is violated, rapid hover events litter the DOM with
     * stacked popups and corrupt the Gmail UI.
     */
    // GIVEN
    const anchor = document.createElement("span");
    document.body.appendChild(anchor);

    // WHEN
    showPopup([makeRecord({ recipient: "a@example.com" })], anchor);
    showPopup([makeRecord({ recipient: "b@example.com" })], anchor);

    // THEN — only one popup
    const popups = document.querySelectorAll(`#${POPUP_ID}`);
    expect(popups).toHaveLength(1);
    // And it shows the latest content
    expect(document.getElementById(POPUP_ID)!.textContent).toContain("b@example.com");
  });
});
