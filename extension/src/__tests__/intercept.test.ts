import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Stubs for chrome, MutationObserver, and dependencies
// ---------------------------------------------------------------------------
// REVIEW: mocking core dependency — test may not reflect real behavior

vi.stubGlobal("chrome", {
  runtime: {
    sendMessage: vi.fn().mockImplementation(
      (_msg: unknown, cb: (resp: { token: string }) => void) =>
        cb({ token: "tok_mock" })
    ),
  },
  identity: {
    getAuthToken: vi.fn(),
  },
});

// Stub the gmail sub-modules before importing intercept
const mockReadCompose = vi.fn(() => ({
  recipients: ["a@example.com"],
  subject: "Test",
  bodyHtml: "<p>body</p>",
}));

const mockSendTrackedEmails = vi.fn().mockResolvedValue(undefined);
const mockGetAuthToken = vi.fn().mockResolvedValue("tok_mock");

vi.mock("../gmail/compose.js", () => ({
  readCompose: mockReadCompose,
}));

vi.mock("../gmail/send.js", () => ({
  sendTrackedEmails: mockSendTrackedEmails,
}));

vi.mock("../gmail/auth.js", () => ({
  getAuthToken: mockGetAuthToken,
  getAuthTokenInBackground: vi.fn().mockResolvedValue("tok_mock"),
}));

// ---------------------------------------------------------------------------
// Tests for intercept.ts
// ---------------------------------------------------------------------------

describe("observeComposeWindows", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // Reset call counts but keep implementations
    mockReadCompose.mockClear();
    mockSendTrackedEmails.mockClear();
    mockGetAuthToken.mockClear();
  });

  it("exports an observeComposeWindows function", async () => {
    /**
     * Verifies that the intercept module exports observeComposeWindows as a
     * callable function.
     *
     * The content script calls observeComposeWindows() on load; if it is not
     * exported the content script throws a TypeError immediately and the
     * extension does nothing.
     *
     * If this contract is violated, the extension fails to initialize on every
     * Gmail page load.
     */
    const { observeComposeWindows } = await import("../gmail/intercept.js");
    expect(typeof observeComposeWindows).toBe("function");
  });

  it("attaches click listener to send buttons in newly added compose nodes", async () => {
    /**
     * Verifies that observeComposeWindows detects send buttons in new DOM nodes
     * added to the page and attaches click intercept listeners to them.
     *
     * Without attaching listeners the send intercept never fires, and emails
     * are delivered without tracking pixels — the extension does nothing.
     *
     * If this contract is violated, users see their emails sent normally with
     * no tracking, and the dashboard is always empty.
     */
    const { observeComposeWindows } = await import("../gmail/intercept.js");

    let capturedCallback: MutationCallback | null = null;
    const OriginalMO = window.MutationObserver;

    vi.stubGlobal(
      "MutationObserver",
      vi.fn(function (this: MutationObserver, cb: MutationCallback) {
        capturedCallback = cb;
        this.observe = vi.fn();
        this.disconnect = vi.fn();
        this.takeRecords = () => [];
      })
    );

    observeComposeWindows();
    expect(capturedCallback).not.toBeNull();

    // Simulate Gmail adding a send button to the DOM
    const sendBtn = document.createElement("button");
    sendBtn.setAttribute("data-tooltip", "Send ‪(Ctrl-Enter)‬");
    document.body.appendChild(sendBtn);

    capturedCallback!(
      [
        {
          type: "childList",
          addedNodes: [sendBtn] as unknown as NodeList,
          removedNodes: [] as unknown as NodeList,
          target: document.body,
          previousSibling: null,
          nextSibling: null,
          attributeName: null,
          attributeNamespace: null,
          oldValue: null,
        } satisfies MutationRecord,
      ],
      {} as MutationObserver
    );

    // Verify a listener was attached by triggering a click and checking the mock
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    sendBtn.dispatchEvent(clickEvent);

    // sendTrackedEmails is called asynchronously after getAuthToken resolves
    await Promise.resolve();
    await Promise.resolve();

    expect(mockGetAuthToken).toHaveBeenCalled();

    vi.stubGlobal("MutationObserver", OriginalMO);
  });

  it("calls preventDefault and stopImmediatePropagation on send button click", async () => {
    /**
     * Verifies that the click handler on the send button prevents the default
     * Gmail send action and stops other listeners from firing.
     *
     * Without preventDefault, Gmail sends the email immediately before the
     * per-recipient loop runs, resulting in a duplicate (untracked) send.
     * Without stopImmediatePropagation, other Gmail listeners could also
     * trigger a send.
     *
     * If this contract is violated, the recipient gets two emails — one
     * untracked group email and one tracked individual copy.
     */
    const { observeComposeWindows } = await import("../gmail/intercept.js");

    let capturedCallback: MutationCallback | null = null;
    const OriginalMO = window.MutationObserver;

    vi.stubGlobal(
      "MutationObserver",
      vi.fn(function (this: MutationObserver, cb: MutationCallback) {
        capturedCallback = cb;
        this.observe = vi.fn();
        this.disconnect = vi.fn();
        this.takeRecords = () => [];
      })
    );

    observeComposeWindows();

    const sendBtn = document.createElement("button");
    sendBtn.setAttribute("data-tooltip", "Send ‪(Ctrl-Enter)‬");
    document.body.appendChild(sendBtn);

    capturedCallback!(
      [
        {
          type: "childList",
          addedNodes: [sendBtn] as unknown as NodeList,
          removedNodes: [] as unknown as NodeList,
          target: document.body,
          previousSibling: null,
          nextSibling: null,
          attributeName: null,
          attributeNamespace: null,
          oldValue: null,
        } satisfies MutationRecord,
      ],
      {} as MutationObserver
    );

    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(clickEvent, "preventDefault");
    const stopSpy = vi.spyOn(clickEvent, "stopImmediatePropagation");
    sendBtn.dispatchEvent(clickEvent);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();

    vi.stubGlobal("MutationObserver", OriginalMO);
  });
});
