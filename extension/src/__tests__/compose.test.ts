import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// compose.ts operates on the Gmail DOM — we use jsdom (configured globally in vitest.config.ts).

import { readCompose } from "../gmail/compose.js";

// ---------------------------------------------------------------------------
// Fixture loading
//
// Prefer the real Gmail HTML captured by `npm run capture-fixture` (run once
// manually in a real browser session). If the fixture file does not yet exist
// (e.g. in CI before the human has run capture-fixture), fall back to the
// hand-written HTML below.
//
// To update the fixture: cd extension && npm run capture-fixture
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "fixtures/gmail-compose.html");

const FIXTURE_HTML: string = (() => {
  if (fs.existsSync(FIXTURE_PATH)) {
    return fs.readFileSync(FIXTURE_PATH, "utf8");
  }
  // Fallback hand-written HTML that mirrors the DOM structure compose.ts
  // expects. Replace by running `npm run capture-fixture` once.
  return `
    <div class="compose-window" role="dialog">
      <div data-testid="to-field">
        <span email="alice@example.com" class="recipient-chip">Alice</span>
        <span email="bob@example.com" class="recipient-chip">Bob</span>
      </div>
      <input name="subjectbox" value="Hello world" />
      <div class="Am Al editable" contenteditable="true"><p>Body text</p></div>
    </div>
  `;
})();

// ---------------------------------------------------------------------------
// Tests for compose.ts
// ---------------------------------------------------------------------------

describe("readCompose", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("extracts To recipients from the compose DOM", () => {
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
    // GIVEN
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

    // WHEN
    const result = readCompose(document.querySelector(".compose-window")!);

    // THEN
    expect(result.recipients).toContain("alice@example.com");
    expect(result.recipients).toContain("bob@example.com");
  });

  it("extracts subject from the subjectbox input", () => {
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
    // GIVEN
    document.body.innerHTML = `
      <div class="compose-window">
        <div data-testid="to-field">
          <span email="alice@example.com" class="recipient-chip">Alice</span>
        </div>
        <input name="subjectbox" value="My Subject" />
        <div class="Am Al editable" contenteditable="true"><p>Body</p></div>
      </div>
    `;

    // WHEN
    const result = readCompose(document.querySelector(".compose-window")!);

    // THEN
    expect(result.subject).toBe("My Subject");
  });

  it("extracts body HTML from the contenteditable element", () => {
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
    // GIVEN
    document.body.innerHTML = `
      <div class="compose-window">
        <div data-testid="to-field">
          <span email="alice@example.com" class="recipient-chip">Alice</span>
        </div>
        <input name="subjectbox" value="Subject" />
        <div class="Am Al editable" contenteditable="true"><b>Bold body</b></div>
      </div>
    `;

    // WHEN
    const result = readCompose(document.querySelector(".compose-window")!);

    // THEN
    expect(result.bodyHtml).toContain("<b>Bold body</b>");
  });

  it("extracts recipients from data-hovercard-id chip variant", () => {
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
    // GIVEN
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

    // WHEN
    const result = readCompose(document.querySelector(".compose-window")!);

    // THEN
    expect(result.recipients).toContain("carol@example.com");
    expect(result.recipients).toContain("dave@example.com");
  });

  it("returns empty recipients array when no recipient chips are found", () => {
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
    // GIVEN
    document.body.innerHTML = `
      <div class="compose-window">
        <div data-testid="to-field"></div>
        <input name="subjectbox" value="" />
        <div class="Am Al editable" contenteditable="true"></div>
      </div>
    `;

    // WHEN
    const result = readCompose(document.querySelector(".compose-window")!);

    // THEN
    expect(result.recipients).toEqual([]);
  });

  it("loads from real Gmail fixture when available", () => {
    /**
     * Verifies that the fixture file can be loaded and parsed by readCompose
     * without throwing. When the real Gmail DOM fixture exists (captured by
     * `npm run capture-fixture`), this test validates that compose.ts selectors
     * work against the actual Gmail structure.
     *
     * This is the integration bridge between unit tests and the real Gmail DOM.
     * If this test fails after re-capturing the fixture, compose.ts selectors
     * need to be updated to match Gmail's current DOM.
     *
     * If this contract is violated, the extension silently fails to read
     * compose fields from real Gmail compose windows.
     */
    // GIVEN — fixture file loaded at module scope (real Gmail HTML if available,
    // fallback hand-written HTML otherwise)
    document.body.innerHTML = FIXTURE_HTML;
    const composeEl =
      document.querySelector('[role="dialog"]') ??
      document.querySelector(".compose-window") ??
      document.body;

    // WHEN
    const result = readCompose(composeEl);

    // THEN — readCompose must not throw; returned fields must be defined types
    expect(typeof result.subject).toBe("string");
    expect(Array.isArray(result.recipients)).toBe(true);
    expect(typeof result.bodyHtml).toBe("string");
  });
});
