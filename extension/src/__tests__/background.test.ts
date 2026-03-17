import { describe, it, expect, vi } from "vitest";

// The chrome global (including chrome.identity.getAuthToken) is installed by
// setup.ts before this module is imported.
// REVIEW: mocking core dependency — test may not reflect real behavior

import { handleMessage } from "../background.js";

describe("background service worker", () => {
  it("registers handleMessage as the chrome.runtime.onMessage listener on load", () => {
    /**
     * Verifies that the background service worker registers handleMessage with
     * chrome.runtime.onMessage when the module loads.
     *
     * This matters because the background script is the sole message bus
     * between the content script and the backend API. If no listener is
     * registered, every message from the content script is silently dropped
     * and no tracking events are ever recorded.
     */
    // GIVEN
    const addListener = (chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>);

    // WHEN
    // (registration happens at module load time — we assert the outcome)

    // THEN
    expect(addListener).toHaveBeenCalledWith(handleMessage);
  });

  it("GET_AUTH_TOKEN message fetches a token and calls sendResponse with it", async () => {
    /**
     * Verifies that handleMessage responds to { type: 'GET_AUTH_TOKEN' } by
     * fetching an OAuth token via chrome.identity and passing it back via
     * sendResponse.
     *
     * Content scripts cannot call chrome.identity.getAuthToken directly —
     * that API is restricted to service workers. handleMessage is the only
     * bridge. If it does not relay the token, every Gmail API call from the
     * content script fails with a 401.
     */
    // GIVEN
    const getAuthToken = (chrome.identity.getAuthToken as ReturnType<typeof vi.fn>);
    getAuthToken.mockImplementation(
      (_opts: unknown, cb: (result: { token?: string }) => void) =>
        cb({ token: "tok_relay" })
    );
    const sendResponse = vi.fn();

    // WHEN
    const result = handleMessage({ type: "GET_AUTH_TOKEN" }, {} as chrome.runtime.MessageSender, sendResponse);
    await Promise.resolve(); // flush async getAuthTokenInBackground

    // THEN
    expect(result).toBe(true); // true keeps the message channel open for async response
    expect(getAuthToken).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ token: "tok_relay" });
  });

  it("GET_AUTH_TOKEN calls sendResponse with undefined token when user is not signed in", async () => {
    /**
     * Verifies that handleMessage still calls sendResponse when
     * chrome.identity returns no token (user declined or not signed in).
     *
     * If sendResponse is never called, the content script's auth promise
     * hangs forever — silently blocking every send attempt with no error shown.
     */
    // GIVEN
    const getAuthToken = (chrome.identity.getAuthToken as ReturnType<typeof vi.fn>);
    getAuthToken.mockImplementation(
      (_opts: unknown, cb: (result: { token?: string }) => void) => cb({})
    );
    const sendResponse = vi.fn();

    // WHEN
    handleMessage({ type: "GET_AUTH_TOKEN" }, {} as chrome.runtime.MessageSender, sendResponse);
    await Promise.resolve();
    await Promise.resolve(); // two ticks: rejection + catch handler

    // THEN
    expect(sendResponse).toHaveBeenCalledWith({ token: undefined });
  });

  it("ignores messages with an unrecognised type", () => {
    /**
     * Verifies that handleMessage returns undefined (not true) for unknown
     * message types, keeping the channel closed and preventing memory leaks
     * from unclosed response channels.
     */
    // GIVEN
    const sendResponse = vi.fn();

    // WHEN
    const result = handleMessage({ type: "UNKNOWN" }, {} as chrome.runtime.MessageSender, sendResponse);

    // THEN
    expect(result).toBeUndefined();
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
