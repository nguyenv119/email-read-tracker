import { describe, it, expect, vi, beforeAll } from "vitest";

// ---------------------------------------------------------------------------
// chrome API stub — must be set up before the module is imported
// ---------------------------------------------------------------------------
// REVIEW: mocking core dependency — test may not reflect real behavior

const getAuthTokenMock = vi.fn();

const chromeMock = {
  runtime: {
    onMessage: {
      addListener: vi.fn(),
    },
  },
  identity: {
    getAuthToken: getAuthTokenMock,
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

// Helper to retrieve the registered listener from the mock.
function getListener(): (
  msg: unknown,
  sender: unknown,
  sendResponse: (r: unknown) => void
) => boolean | undefined {
  return (
    chromeMock.runtime.onMessage.addListener as ReturnType<typeof vi.fn>
  ).mock.calls[0][0] as (
    msg: unknown,
    sender: unknown,
    sendResponse: (r: unknown) => void
  ) => boolean | undefined;
}

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

  it("GET_AUTH_TOKEN message triggers chrome.identity.getAuthToken and calls sendResponse with token", async () => {
    /**
     * Verifies that the message handler responds to { type: 'GET_AUTH_TOKEN' }
     * by calling chrome.identity.getAuthToken and passing { token } back via
     * sendResponse.
     *
     * Content scripts cannot call chrome.identity.getAuthToken directly —
     * that API is restricted to service workers. The background handler is the
     * only bridge. If it does not relay the token, every auth attempt from a
     * content script fails with a hard crash.
     *
     * If this contract is violated, no OAuth token is ever obtained from a
     * content script context and every Gmail API send fails with a 401.
     */
    getAuthTokenMock.mockImplementation(
      (_opts: unknown, cb: (result: { token?: string }) => void) =>
        cb({ token: "tok_relay" })
    );

    const listener = getListener();
    const sendResponse = vi.fn();
    const result = listener({ type: "GET_AUTH_TOKEN" }, {}, sendResponse);

    // The handler must return true to keep the message channel open for async responses
    expect(result).toBe(true);

    // Flush the microtask queue so the async getAuthTokenInBackground Promise resolves
    await Promise.resolve();

    expect(getAuthTokenMock).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ token: "tok_relay" });
  });

  it("GET_AUTH_TOKEN sends empty token when chrome.identity returns undefined", async () => {
    /**
     * Verifies that when chrome.identity.getAuthToken returns undefined
     * (user declined or not signed in), the background still calls sendResponse
     * with { token: undefined } rather than hanging the channel.
     *
     * If sendResponse is never called, the content script's callback never
     * fires and the auth promise never resolves or rejects — causing a silent
     * hang on every send attempt.
     *
     * If this contract is violated, auth failures leave the content script
     * in a permanently suspended state with no error shown.
     */
    getAuthTokenMock.mockImplementation(
      (_opts: unknown, cb: (result: { token?: string }) => void) => cb({})
    );

    const listener = getListener();
    const sendResponse = vi.fn();
    listener({ type: "GET_AUTH_TOKEN" }, {}, sendResponse);

    // Flush microtasks: the handler rejects -> .catch -> sendResponse
    await Promise.resolve();
    await Promise.resolve(); // two ticks: one for rejection, one for catch handler

    expect(sendResponse).toHaveBeenCalledWith({ token: undefined });
  });
});
