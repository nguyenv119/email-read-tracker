import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// chrome API stub
// ---------------------------------------------------------------------------
// REVIEW: mocking core dependency — test may not reflect real behavior

const getAuthTokenMock = vi.fn();
const sendMessageMock = vi.fn();

vi.stubGlobal("chrome", {
  identity: {
    getAuthToken: getAuthTokenMock,
  },
  runtime: {
    sendMessage: sendMessageMock,
  },
});

import { getAuthTokenInBackground, getAuthToken } from "../gmail/auth.js";

// ---------------------------------------------------------------------------
// Tests for auth.ts
// ---------------------------------------------------------------------------

describe("getAuthToken (background-side wrapper)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("resolves with the token when chrome.identity.getAuthToken succeeds", async () => {
    /**
     * Verifies that getAuthTokenInBackground resolves with the OAuth token
     * string returned by chrome.identity.getAuthToken.
     *
     * This is the happy path: without a valid token no Gmail API call can be
     * authorized, so tracking is entirely broken.
     *
     * If this contract is violated, every send attempt fails with a 401 and
     * no email is ever tracked.
     */
    // GIVEN
    getAuthTokenMock.mockImplementation(
      (_opts: unknown, cb: (result: { token?: string }) => void) =>
        cb({ token: "tok_abc" })
    );

    // WHEN
    const token = await getAuthTokenInBackground();

    // THEN
    expect(token).toBe("tok_abc");
  });

  it("rejects when chrome.identity.getAuthToken returns undefined (auth declined)", async () => {
    /**
     * Verifies that getAuthTokenInBackground rejects when the user denies
     * the OAuth consent screen or the browser returns no token.
     *
     * Swallowing an undefined token and proceeding would cause every
     * subsequent API call to fail with a cryptic network error rather than
     * a clear auth error.
     *
     * If this contract is violated, the extension silently fails to send
     * tracked emails with no feedback to the user.
     */
    // GIVEN
    getAuthTokenMock.mockImplementation(
      (_opts: unknown, cb: (result: { token?: string }) => void) => cb({})
    );

    // WHEN / THEN
    await expect(getAuthTokenInBackground()).rejects.toThrow(/auth token/i);
  });
});

describe("getAuthToken (content-script side — sends message to background)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sends GET_AUTH_TOKEN message and resolves with the returned token", async () => {
    /**
     * Verifies that getAuthToken (the content-script side) sends a
     * { type: 'GET_AUTH_TOKEN' } message to the background service worker
     * and resolves with the token it returns.
     *
     * Content scripts cannot call chrome.identity.getAuthToken directly; it
     * is only available in the service worker. The message-passing bridge is
     * the only way to retrieve the token from a content script.
     *
     * If this contract is violated, every send attempt from a content script
     * fails with "chrome.identity is not a function" — a hard crash.
     */
    // GIVEN
    sendMessageMock.mockImplementation(
      (_msg: unknown, cb: (resp: { token: string }) => void) =>
        cb({ token: "tok_xyz" })
    );

    // WHEN
    const token = await getAuthToken();

    // THEN
    expect(sendMessageMock).toHaveBeenCalledWith(
      { type: "GET_AUTH_TOKEN" },
      expect.any(Function)
    );
    expect(token).toBe("tok_xyz");
  });

  it("rejects when the background responds without a token", async () => {
    /**
     * Verifies that getAuthToken rejects when the background response does
     * not contain a token field (e.g. the handler is not yet implemented or
     * the user denied auth).
     *
     * Without this guard the caller would receive undefined and attempt to
     * set "Authorization: Bearer undefined", causing a 401 on every request.
     *
     * If this contract is violated, sends fail silently with bad auth headers.
     */
    // GIVEN
    sendMessageMock.mockImplementation(
      (_msg: unknown, cb: (resp: Record<string, unknown>) => void) => cb({})
    );

    // WHEN / THEN
    await expect(getAuthToken()).rejects.toThrow(/auth token/i);
  });
});
