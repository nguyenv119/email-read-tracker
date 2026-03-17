import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock intercept.ts — content.ts's only direct dependency
// ---------------------------------------------------------------------------
// REVIEW: mocking core dependency — test may not reflect real behavior

vi.mock("../gmail/intercept.js", () => ({
  observeComposeWindows: vi.fn(),
}));

import { observeComposeWindows } from "../gmail/intercept.js";

// Side-effect import: loading this module calls observeComposeWindows() once.
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
     * content.ts's only job is to bootstrap intercept.ts. If it does not call
     * observeComposeWindows(), the MutationObserver is never started and the
     * extension does nothing on Gmail pages.
     *
     * If this contract is violated, the extension installs silently but never
     * intercepts any send buttons — tracking is completely broken.
     */
    // GIVEN
    // vi.mock above ensures observeComposeWindows is a spy; the module has
    // already been loaded as a side-effect import above.

    // WHEN
    // Module already loaded at import time (side-effect import).

    // THEN
    expect(observeComposeWindows).toHaveBeenCalledOnce();
  });
});
