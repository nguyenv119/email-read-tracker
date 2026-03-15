import { describe, it, expect, vi, beforeAll } from "vitest";

// ---------------------------------------------------------------------------
// chrome API stub — must be set up before the module is imported
// ---------------------------------------------------------------------------
// REVIEW: mocking core dependency — test may not reflect real behavior

const chromeMock = {
  runtime: {
    onMessage: {
      addListener: vi.fn(),
    },
  },
};

vi.stubGlobal("chrome", chromeMock);

// Import the module under test after the stub is in place.
// The module executes its top-level side effects (addListener call) on import.
// We use a dynamic import inside beforeAll so the stub is active first.
let _module: unknown;
beforeAll(async () => {
  _module = await import("../background.js");
  void _module;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("background service worker", () => {
  it("registers a chrome.runtime.onMessage listener on load", () => {
    /**
     * Verifies that the background service worker registers exactly one
     * chrome.runtime.onMessage listener when the module is loaded.
     *
     * This matters because the background script is the sole message bus
     * between the content script and the backend API. If no listener is
     * registered, every message from the content script is silently dropped
     * and no tracking events are ever forwarded.
     *
     * If this contract is violated, users would send emails but no open
     * events would ever be recorded — tracking would be completely broken
     * with no visible error.
     */
    expect(chromeMock.runtime.onMessage.addListener).toHaveBeenCalledOnce();
  });

  it("listener is a function", () => {
    /**
     * Verifies the value passed to addListener is callable.
     *
     * chrome.runtime.onMessage.addListener silently discards non-function
     * arguments in some environments, meaning a mis-typed handler would
     * register nothing and all messages would be lost.
     *
     * If this contract is violated, the extension appears to load correctly
     * (no console errors) but never responds to any content-script message.
     */
    expect(chromeMock.runtime.onMessage.addListener).toHaveBeenCalledWith(
      expect.any(Function)
    );
  });
});
