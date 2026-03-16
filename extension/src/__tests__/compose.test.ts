import { describe, it, expect, beforeEach } from "vitest";

// compose.ts operates on the Gmail DOM — we use jsdom (configured globally in vitest.config.ts).

// ---------------------------------------------------------------------------
// Tests for compose.ts
// ---------------------------------------------------------------------------

describe("readCompose", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("extracts To recipients from the compose DOM", async () => {
    /**
     * Verifies that readCompose parses the To-field chips in a Gmail compose
     * window and returns them as an array of email strings.
     *
     * The To list drives per-recipient send logic — if recipients cannot be
     * read, no individualized copies can be sent and tracking is impossible.
     *
     * If this contract is violated, the send loop iterates over an empty
     * array and the user's email is never delivered.
     */
    document.body.innerHTML = `
      <div class="compose-window">
        <div data-testid="to-field">
          <span email="alice@example.com" class="recipient-chip">Alice</span>
          <span email="bob@example.com" class="recipient-chip">Bob</span>
        </div>
        <input name="subjectbox" value="Hello world" />
        <div class="Am Al editable" contenteditable="true"><p>Body text</p></div>
      </div>
    `;
    const { readCompose } = await import("../gmail/compose.js");
    const result = readCompose(document.querySelector(".compose-window")!);
    expect(result.recipients).toContain("alice@example.com");
    expect(result.recipients).toContain("bob@example.com");
  });

  it("extracts subject from the subjectbox input", async () => {
    /**
     * Verifies that readCompose reads the email subject from the Gmail
     * compose subject input element.
     *
     * The subject is included in every per-recipient MIME message and also
     * stored in DynamoDB for display in the tracking dashboard. A missing
     * subject means the tracking record cannot be identified by the sender.
     *
     * If this contract is violated, every tracked email appears in the
     * dashboard with an empty subject.
     */
    document.body.innerHTML = `
      <div class="compose-window">
        <div data-testid="to-field">
          <span email="alice@example.com" class="recipient-chip">Alice</span>
        </div>
        <input name="subjectbox" value="My Subject" />
        <div class="Am Al editable" contenteditable="true"><p>Body</p></div>
      </div>
    `;
    const { readCompose } = await import("../gmail/compose.js");
    const result = readCompose(document.querySelector(".compose-window")!);
    expect(result.subject).toBe("My Subject");
  });

  it("extracts body HTML from the contenteditable element", async () => {
    /**
     * Verifies that readCompose captures the full innerHTML of the compose
     * body contenteditable div.
     *
     * The body HTML is cloned per recipient and has the tracking pixel
     * injected before being sent. If body extraction fails, sends would go
     * out with an empty body.
     *
     * If this contract is violated, every tracked email has an empty body —
     * a highly visible regression for users.
     */
    document.body.innerHTML = `
      <div class="compose-window">
        <div data-testid="to-field">
          <span email="alice@example.com" class="recipient-chip">Alice</span>
        </div>
        <input name="subjectbox" value="Subject" />
        <div class="Am Al editable" contenteditable="true"><b>Bold body</b></div>
      </div>
    `;
    const { readCompose } = await import("../gmail/compose.js");
    const result = readCompose(document.querySelector(".compose-window")!);
    expect(result.bodyHtml).toContain("<b>Bold body</b>");
  });

  it("extracts recipients from data-hovercard-id chip variant", async () => {
    /**
     * Verifies that readCompose handles Gmail chips that use the
     * data-hovercard-id attribute (e.g. "email=alice@example.com") instead of
     * the plain email attribute.
     *
     * Gmail uses this alternate chip format in some contexts. If it is not
     * handled, those recipients are silently dropped and never receive the
     * tracked email.
     *
     * If this contract is violated, recipients added via autocomplete appear in
     * the compose window but their copy is never sent.
     */
    document.body.innerHTML = `
      <div class="compose-window">
        <div data-testid="to-field">
          <span data-hovercard-id="email=carol@example.com" class="recipient-chip">Carol</span>
          <span data-hovercard-id="dave@example.com" class="recipient-chip">Dave</span>
        </div>
        <input name="subjectbox" value="Hello" />
        <div class="Am Al editable" contenteditable="true"><p>Body</p></div>
      </div>
    `;
    const { readCompose } = await import("../gmail/compose.js");
    const result = readCompose(document.querySelector(".compose-window")!);
    expect(result.recipients).toContain("carol@example.com");
    expect(result.recipients).toContain("dave@example.com");
  });

  it("returns empty recipients array when no recipient chips are found", async () => {
    /**
     * Verifies that readCompose returns an empty recipients array rather than
     * throwing when no recipient chips exist in the compose DOM.
     *
     * A compose window can be open but empty — throwing here would crash the
     * intercept handler and block the user from sending at all.
     *
     * If this contract is violated, opening an empty compose window crashes
     * the content script.
     */
    document.body.innerHTML = `
      <div class="compose-window">
        <div data-testid="to-field"></div>
        <input name="subjectbox" value="" />
        <div class="Am Al editable" contenteditable="true"></div>
      </div>
    `;
    const { readCompose } = await import("../gmail/compose.js");
    const result = readCompose(document.querySelector(".compose-window")!);
    expect(result.recipients).toEqual([]);
  });
});
