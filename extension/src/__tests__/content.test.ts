import { describe, it, expect, vi, beforeAll } from "vitest";

// ---------------------------------------------------------------------------
// MutationObserver stub — must be set up before the module is imported
// ---------------------------------------------------------------------------
// REVIEW: mocking core dependency — test may not reflect real behavior

let capturedCallback: MutationCallback | null = null;
let capturedTarget: Node | null = null;
let capturedOptions: MutationObserverInit | null = null;

const MockMutationObserver = vi.fn(function (
  this: MutationObserver,
  callback: MutationCallback
) {
  capturedCallback = callback;
  this.observe = vi.fn((target: Node, options?: MutationObserverInit) => {
    capturedTarget = target;
    capturedOptions = options ?? null;
  });
});

vi.stubGlobal("MutationObserver", MockMutationObserver);

// Import the module under test after stubs are in place.
let _module: unknown;
beforeAll(async () => {
  _module = await import("../content.js");
  void _module;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("content script", () => {
  it("instantiates a MutationObserver on load", () => {
    /**
     * Verifies the content script creates a MutationObserver when the
     * module loads.
     *
     * The content script must observe Gmail DOM mutations to detect when a
     * compose window appears. Without a MutationObserver the script has no
     * way to react to Gmail's dynamic rendering and can never inject the
     * tracking pixel.
     *
     * If this contract is violated, the extension loads without errors but
     * the compose-window injection never fires, so no pixels are added and
     * no emails are tracked.
     */
    expect(MockMutationObserver).toHaveBeenCalledOnce();
  });

  it("observer callback is a function", () => {
    /**
     * Verifies the callback passed to MutationObserver is callable.
     *
     * A non-function argument would cause a TypeError at runtime when the
     * browser tries to invoke the callback on a DOM mutation, crashing the
     * content script entirely.
     *
     * If this contract is violated, any Gmail DOM change throws an uncaught
     * TypeError that kills the content script for the remainder of the tab
     * session.
     */
    expect(capturedCallback).toBeTypeOf("function");
  });

  it("observer watches document.body", () => {
    /**
     * Verifies that observe() is called with document.body as the target.
     *
     * Gmail renders compose windows as children of document.body. Observing
     * any other node (or no node) means mutations to compose windows are
     * invisible to the script and injection never happens.
     *
     * If this contract is violated, the extension installs successfully but
     * the compose-detect logic never fires, so tracking pixels are never
     * injected.
     */
    expect(capturedTarget).toBe(document.body);
  });

  it("observer uses subtree mode", () => {
    /**
     * Verifies that observe() is called with { subtree: true }.
     *
     * Gmail inserts compose windows deep in the DOM hierarchy. Without
     * subtree observation only direct children of document.body would
     * trigger callbacks, missing all nested compose elements.
     *
     * If this contract is violated, compose-window events are never detected
     * even though the observer is running, causing complete tracking failure.
     */
    expect(capturedOptions).toMatchObject({ subtree: true });
  });
});
