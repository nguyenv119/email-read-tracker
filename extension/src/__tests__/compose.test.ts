import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// compose.ts operates on the Gmail DOM — we use jsdom (configured globally in vitest.config.ts).

import { readCompose } from "../gmail/compose.js";

// ---------------------------------------------------------------------------
// Fixture loading
//
// Load the real Gmail HTML captured by `npm run capture-fixture`.
// This fixture reflects the actual Gmail DOM structure that compose.ts must
// parse in production. Tests inject recipients, subject, and body into the
// fixture DOM before each assertion.
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "fixtures/gmail-compose.html");
const FIXTURE_HTML: string = fs.readFileSync(FIXTURE_PATH, "utf8");

// ---------------------------------------------------------------------------
// setupFixture
//
// Inserts the Gmail fixture into jsdom, optionally injects recipient chips,
// sets subject, and sets body HTML. Returns the compose root element
// (div[role="dialog"]).
//
// recipients: array of email strings to inject as <span email="..."> chips
//   inside div[name="to"] > div.afp, before the PeopleKit widget (so they
//   are NOT inside [role="listbox"] and will be picked up by compose.ts).
// subject: value to set on input[name="subjectbox"]
// bodyHtml: innerHTML to set on the first contenteditable div
// ---------------------------------------------------------------------------

interface FixtureOptions {
  recipients?: string[];
  subject?: string;
  bodyHtml?: string;
}

function setupFixture(opts: FixtureOptions = {}): Element {
  document.body.innerHTML = FIXTURE_HTML;

  const composeEl = document.querySelector('[role="dialog"]');
  if (!composeEl) throw new Error("Fixture missing [role='dialog'] root");

  // Inject recipient chips into div[name="to"] > div.afp
  if (opts.recipients && opts.recipients.length > 0) {
    const toContainer = composeEl.querySelector('div[name="to"] .afp');
    if (!toContainer) throw new Error("Fixture missing div[name='to'] .afp");

    for (const email of opts.recipients) {
      const chip = document.createElement("span");
      chip.setAttribute("email", email);
      chip.textContent = email;
      // Prepend so chips appear before the PeopleKit listbox widget
      toContainer.insertBefore(chip, toContainer.firstChild);
    }
  }

  // Set subject via the subject input's .value property
  if (opts.subject !== undefined) {
    const subjectInput = composeEl.querySelector<HTMLInputElement>(
      'input[name="subjectbox"]'
    );
    if (!subjectInput) throw new Error("Fixture missing input[name='subjectbox']");
    // jsdom supports direct .value assignment for programmatic setting
    subjectInput.value = opts.subject;
  }

  // Set body innerHTML on the contenteditable div
  if (opts.bodyHtml !== undefined) {
    const bodyEl = composeEl.querySelector<HTMLElement>(
      '[contenteditable="true"]'
    );
    if (!bodyEl) throw new Error("Fixture missing [contenteditable='true']");
    bodyEl.innerHTML = opts.bodyHtml;
  }

  return composeEl;
}

// ---------------------------------------------------------------------------
// Tests for compose.ts
// ---------------------------------------------------------------------------

describe("readCompose", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("extracts To recipients injected into the real Gmail fixture DOM", () => {
    /**
     * Verifies that readCompose parses recipient chips that are injected into
     * the real Gmail compose fixture's To-field container and returns them as
     * an array of email strings.
     *
     * The To list drives per-recipient send logic — if recipients cannot be
     * read from the real Gmail DOM structure, no individualized copies can be
     * sent and tracking is impossible.
     *
     * If this contract is violated, the send loop iterates over an empty array
     * and the user's email is never delivered.
     */
    // GIVEN
    const composeEl = setupFixture({
      recipients: ["alice@example.com", "bob@example.com"],
      subject: "Hello world",
      bodyHtml: "<p>Body text</p>",
    });

    // WHEN
    const result = readCompose(composeEl);

    // THEN
    expect(result.recipients).toContain("alice@example.com");
    expect(result.recipients).toContain("bob@example.com");
  });

  it("extracts subject from the subjectbox input in the real Gmail fixture", () => {
    /**
     * Verifies that readCompose reads the email subject from the Gmail compose
     * subject input element as it appears in the real captured fixture.
     *
     * The subject is included in every per-recipient MIME message and stored
     * in DynamoDB for display in the tracking dashboard. A missing subject
     * means the tracking record cannot be identified by the sender.
     *
     * If this contract is violated, every tracked email appears in the
     * dashboard with an empty subject.
     */
    // GIVEN
    const composeEl = setupFixture({
      recipients: ["alice@example.com"],
      subject: "My Subject",
      bodyHtml: "<p>Body</p>",
    });

    // WHEN
    const result = readCompose(composeEl);

    // THEN
    expect(result.subject).toBe("My Subject");
  });

  it("extracts body HTML from the contenteditable element in the real Gmail fixture", () => {
    /**
     * Verifies that readCompose captures the full innerHTML of the compose
     * body contenteditable div as present in the real Gmail fixture DOM.
     *
     * The body HTML is cloned per recipient and has the tracking pixel
     * injected before being sent. If body extraction fails, sends would go
     * out with an empty body.
     *
     * If this contract is violated, every tracked email has an empty body —
     * a highly visible regression for users.
     */
    // GIVEN
    const composeEl = setupFixture({
      recipients: ["alice@example.com"],
      subject: "Subject",
      bodyHtml: "<b>Bold body</b>",
    });

    // WHEN
    const result = readCompose(composeEl);

    // THEN
    expect(result.bodyHtml).toContain("<b>Bold body</b>");
  });

  it("extracts recipients from data-hovercard-id chip variant in the real Gmail fixture", () => {
    /**
     * Verifies that readCompose handles Gmail chips that use the
     * data-hovercard-id attribute (e.g. "email=carol@example.com") instead of
     * the plain email attribute, when injected into the real fixture DOM.
     *
     * Gmail uses this alternate chip format in some contexts. If it is not
     * handled, those recipients are silently dropped and never receive the
     * tracked email.
     *
     * If this contract is violated, recipients added via autocomplete appear in
     * the compose window but their copy is never sent.
     */
    // GIVEN — inject chips using data-hovercard-id attribute variants
    const composeEl = setupFixture({
      subject: "Hello",
      bodyHtml: "<p>Body</p>",
    });
    const toContainer = composeEl.querySelector('div[name="to"] .afp')!;
    const chip1 = document.createElement("span");
    chip1.setAttribute("data-hovercard-id", "email=carol@example.com");
    chip1.textContent = "Carol";
    toContainer.insertBefore(chip1, toContainer.firstChild);
    const chip2 = document.createElement("span");
    chip2.setAttribute("data-hovercard-id", "dave@example.com");
    chip2.textContent = "Dave";
    toContainer.insertBefore(chip2, toContainer.firstChild);

    // WHEN
    const result = readCompose(composeEl);

    // THEN
    expect(result.recipients).toContain("carol@example.com");
    expect(result.recipients).toContain("dave@example.com");
  });

  it("returns empty recipients array when no chips are injected into the real Gmail fixture", () => {
    /**
     * Verifies that readCompose returns an empty recipients array rather than
     * throwing when the compose DOM contains no recipient chips — the state of
     * the real fixture by default (no pre-filled recipients).
     *
     * A compose window can be open but empty — throwing here would crash the
     * intercept handler and block the user from sending at all.
     *
     * If this contract is violated, opening an empty compose window crashes
     * the content script.
     */
    // GIVEN — no recipients injected; fixture has an empty To field
    const composeEl = setupFixture();

    // WHEN
    const result = readCompose(composeEl);

    // THEN
    expect(result.recipients).toEqual([]);
  });
});
