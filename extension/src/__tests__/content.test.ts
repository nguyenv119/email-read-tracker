import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock all direct dependencies of content.ts
// ---------------------------------------------------------------------------
// REVIEW: mocking core dependency — test may not reflect real behavior

vi.mock("../gmail/intercept.js", () => ({
  observeComposeWindows: vi.fn(),
}));

vi.mock("../ui/poll.js", () => ({
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  getCache: vi.fn(() => new Map()),
  clearCache: vi.fn(),
  getBySubject: vi.fn(() => []),
}));

vi.mock("../ui/checkmarks.js", () => ({
  observeMessageList: vi.fn(),
  rescanAllRows: vi.fn(),
  CHECKMARK_ATTR: "data-mailtrack-checkmark",
}));

import { observeComposeWindows } from "../gmail/intercept.js";
import { startPolling } from "../ui/poll.js";
import { observeMessageList, rescanAllRows } from "../ui/checkmarks.js";

// Side-effect import: loading this module calls all three bootstrap functions.
import "../content.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("content script", () => {
  it("calls observeComposeWindows on load", () => {
    /**
     * Verifies that the content script calls observeComposeWindows() exactly
     * once when the module is first loaded.
     *
     * content.ts bootstraps intercept.ts. If it does not call
     * observeComposeWindows(), the MutationObserver is never started and the
     * extension never intercepts send buttons.
     *
     * If this contract is violated, the extension installs silently but never
     * intercepts any send buttons — tracking is completely broken.
     */
    // GIVEN
    // vi.mock above ensures observeComposeWindows is a spy.

    // WHEN
    // Module already loaded at import time (side-effect import).

    // THEN
    expect(observeComposeWindows).toHaveBeenCalledOnce();
  });

  it("calls startPolling with rescanAllRows as the onUpdate callback on load", () => {
    /**
     * Verifies that the content script calls startPolling() with rescanAllRows
     * as the onUpdate callback.
     *
     * Without this wiring, rows already in the DOM at page load are never
     * upgraded after polling completes — they remain gray forever even when
     * tracking data exists in the cache.
     *
     * If this contract is violated, rows rendered before the first poll
     * completes show no tracking state until the next DOM mutation.
     */
    // GIVEN
    // vi.mock above ensures startPolling and rescanAllRows are spies.

    // WHEN
    // Module already loaded at import time.

    // THEN
    expect(startPolling).toHaveBeenCalledOnce();
    expect(startPolling).toHaveBeenCalledWith(rescanAllRows);
  });

  it("calls observeMessageList on load", () => {
    /**
     * Verifies that the content script calls observeMessageList() exactly once
     * when the module is first loaded.
     *
     * Without observeMessageList(), the MutationObserver for checkmark
     * injection is never attached and no checkmarks appear in Gmail.
     *
     * If this contract is violated, the polling runs but checkmarks are never
     * injected — the UI is completely non-functional.
     */
    // GIVEN
    // vi.mock above ensures observeMessageList is a spy.

    // WHEN
    // Module already loaded at import time.

    // THEN
    expect(observeMessageList).toHaveBeenCalledOnce();
  });

  it("injects a mailtrack-styles element into document.head on load", () => {
    /**
     * Verifies that the content script appends a <style id="mailtrack-styles">
     * element to document.head when loaded.
     *
     * Without CSS injection, checkmarks and the hover popup have no styling —
     * the ✓/✓✓ spans may be invisible or collide with Gmail's own styles.
     *
     * If this contract is violated, the tracking UI renders as unstyled text
     * that is hard to notice and may disrupt Gmail's layout.
     */
    // GIVEN / WHEN — module already loaded at import time.

    // THEN
    const style = document.getElementById("mailtrack-styles");
    expect(style).not.toBeNull();
    expect(style!.tagName.toLowerCase()).toBe("style");
  });
});
