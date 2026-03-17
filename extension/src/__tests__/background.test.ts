import { describe, it, expect, vi } from "vitest";

// Mock the auth module so this test never reaches into auth.ts internals.
// handleMessage calls getAuthTokenInBackground — that's the direct dependency
// we control here. chrome.identity.getAuthToken is auth.ts's problem, not ours.
vi.mock("../gmail/auth.js", () => ({
  getAuthTokenInBackground: vi.fn(),
}));

import { handleMessage } from "../background.js";
import { getAuthTokenInBackground } from "../gmail/auth.js";

describe("background service worker", () => {
  it("registers handleMessage as the chrome.runtime.onMessage listener on load", () => {
    /**
     * Verifies the background module registers handleMessage with
     * chrome.runtime.onMessage at startup. Without this, every message from
     * the content script is silently dropped and no tokens are ever relayed.
     */
    // GIVEN
    const addListener = chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>;

    // WHEN (registration happens at module load — assert the outcome)

    // THEN
    expect(addListener).toHaveBeenCalledWith(handleMessage);
  });

  it("GET_AUTH_TOKEN message relays the token back via sendResponse", async () => {
    /**
     * Verifies handleMessage calls getAuthTokenInBackground and passes the
     * resolved token to sendResponse. Content scripts cannot call
     * chrome.identity directly — handleMessage is the only bridge.
     * If it fails to relay the token, every Gmail API send fails with a 401.
     */
    // GIVEN
    vi.mocked(getAuthTokenInBackground).mockResolvedValue("tok_relay");
    const sendResponse = vi.fn();

    // WHEN
    const result = handleMessage({ type: "GET_AUTH_TOKEN" }, {} as chrome.runtime.MessageSender, sendResponse);
    await Promise.resolve();

    // THEN
    expect(result).toBe(true); // keeps the message channel open for async response
    expect(sendResponse).toHaveBeenCalledWith({ token: "tok_relay" });
  });

  it("GET_AUTH_TOKEN calls sendResponse with undefined token when auth fails", async () => {
    /**
     * Verifies handleMessage still calls sendResponse when auth fails.
     * If sendResponse is never called, the content script's auth promise
     * hangs forever — silently blocking every send attempt.
     */
    // GIVEN
    vi.mocked(getAuthTokenInBackground).mockRejectedValue(new Error("not signed in"));
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
     * Verifies handleMessage returns undefined for unknown message types,
     * keeping the channel closed and preventing memory leaks from unclosed
     * response channels.
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
