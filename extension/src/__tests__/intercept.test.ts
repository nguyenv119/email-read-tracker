import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Stubs for MutationObserver and module dependencies
// ---------------------------------------------------------------------------
// REVIEW: mocking core dependency — test may not reflect real behavior
// chrome global is stubbed in setup.ts (single authoritative stub).
// auth.js is fully mocked below, so chrome.identity / chrome.runtime.sendMessage
// are never called directly in these tests.

// Use vi.hoisted so these mocks are available when vi.mock factories run.
const { mockReadCompose, mockSendTrackedEmails, mockGetAuthToken } = vi.hoisted(() => ({
  mockReadCompose: vi.fn(() => ({
    recipients: ["a@example.com"],
    subject: "Test",
    bodyHtml: "<p>body</p>",
  })),
  mockSendTrackedEmails: vi.fn().mockResolvedValue(undefined),
  mockGetAuthToken: vi.fn().mockResolvedValue("tok_mock"),
}));

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

import { observeComposeWindows } from "../gmail/intercept.js";

// ---------------------------------------------------------------------------
// Fixture loading — same pattern as compose.test.ts
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "fixtures/gmail-compose.html");
const FIXTURE_HTML: string = fs.readFileSync(FIXTURE_PATH, "utf8");

// ---------------------------------------------------------------------------
// Shared MutationObserver stub helpers
// ---------------------------------------------------------------------------

let capturedCallback: MutationCallback | null = null;
let OriginalMO: typeof MutationObserver;

function setupMutationObserverStub(): void {
  capturedCallback = null;
  OriginalMO = window.MutationObserver;
  vi.stubGlobal(
    "MutationObserver",
    vi.fn(function (this: MutationObserver, cb: MutationCallback) {
      capturedCallback = cb;
      this.observe = vi.fn();
      this.disconnect = vi.fn();
      this.takeRecords = () => [];
    })
  );
}

function teardownMutationObserverStub(): void {
  vi.stubGlobal("MutationObserver", OriginalMO);
}

function fireMutation(addedNode: Node): void {
  capturedCallback!(
    [
      {
        type: "childList",
        addedNodes: [addedNode] as unknown as NodeList,
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
}

// ---------------------------------------------------------------------------
// Tests for intercept.ts
// ---------------------------------------------------------------------------

describe("observeComposeWindows", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mockReadCompose.mockClear();
    mockSendTrackedEmails.mockClear();
    mockGetAuthToken.mockClear();
    setupMutationObserverStub();
  });

  afterEach(() => {
    teardownMutationObserverStub();
  });

  it("exports an observeComposeWindows function that can be called without throwing", () => {
    /**
     * Verifies that the intercept module exports observeComposeWindows and that
     * calling it does not throw.
     *
     * The content script calls observeComposeWindows() on load; if it is not
     * exported or throws, the content script fails to initialize and the
     * extension does nothing.
     *
     * If this contract is violated, the extension fails to initialize on every
     * Gmail page load.
     */
    // GIVEN
    // observeComposeWindows is statically imported above; MutationObserver stub
    // is installed in beforeEach.

    // WHEN / THEN
    expect(() => observeComposeWindows()).not.toThrow();
  });

  it("attaches click listener to send buttons in newly added compose nodes from the real Gmail fixture", async () => {
    /**
     * Verifies that observeComposeWindows detects the real Gmail send button
     * (a div[role="button"][data-tooltip*="Send"], not a <button>) inside a
     * newly added compose dialog node and fires the auth + send pipeline on
     * click.
     *
     * Without matching div[role="button"] elements the intercept never fires
     * in production — Gmail uses <div>, not <button>. This is a P1 bug if
     * the selector is wrong.
     *
     * If this contract is violated, users' emails are sent as untracked group
     * emails and the dashboard is always empty.
     */
    // GIVEN
    observeComposeWindows();
    expect(capturedCallback).not.toBeNull();

    document.body.innerHTML = FIXTURE_HTML;
    const composeDialog = document.querySelector('[role="dialog"]')! as HTMLElement;
    const sendBtn = composeDialog.querySelector('[data-tooltip*="Send"]')! as HTMLElement;

    // WHEN — the MutationObserver fires with the compose dialog as the added node
    fireMutation(composeDialog);

    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    sendBtn.dispatchEvent(clickEvent);

    // sendTrackedEmails is called asynchronously after getAuthToken resolves
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // THEN
    expect(mockGetAuthToken).toHaveBeenCalled();
    expect(mockSendTrackedEmails).toHaveBeenCalled();
  });

  it("calls preventDefault and stopImmediatePropagation on the real Gmail send button click", () => {
    /**
     * Verifies that the click handler on the real Gmail send button (a
     * div[role="button"]) prevents the default Gmail send action and stops
     * other listeners from firing.
     *
     * Without preventDefault, Gmail sends the email immediately before the
     * per-recipient loop runs, resulting in a duplicate (untracked) send.
     * Without stopImmediatePropagation, other Gmail listeners could also
     * trigger a send.
     *
     * If this contract is violated, the recipient gets two emails — one
     * untracked group email and one tracked individual copy.
     */
    // GIVEN
    observeComposeWindows();

    document.body.innerHTML = FIXTURE_HTML;
    const composeDialog = document.querySelector('[role="dialog"]')! as HTMLElement;
    const sendBtn = composeDialog.querySelector('[data-tooltip*="Send"]')! as HTMLElement;

    // Fire mutation with the compose dialog so the observer finds the send button inside it
    fireMutation(composeDialog);

    // WHEN
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(clickEvent, "preventDefault");
    const stopSpy = vi.spyOn(clickEvent, "stopImmediatePropagation");
    sendBtn.dispatchEvent(clickEvent);

    // THEN
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
  });
});
