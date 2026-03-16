/**
 * Gmail compose DOM reader.
 *
 * Parses the three fields we need from a Gmail compose window element:
 *  - recipients  (To, CC, BCC)  via data-hovercard-id or email attributes on chips
 *  - subject                    via input[name="subjectbox"]
 *  - bodyHtml                   via the compose contenteditable div
 *
 * Gmail's class names are obfuscated and change frequently; we rely on
 * stable data attributes and element names instead.
 */

export interface ComposeData {
  recipients: string[];
  subject: string;
  bodyHtml: string;
}

/**
 * Read compose fields from a Gmail compose window DOM element.
 *
 * @param composeEl - The root element of the compose window (e.g. the element
 *                    that contains both the send button and the editable fields).
 *                    Pass `document.documentElement` if targeting the full page.
 */
export function readCompose(composeEl: Element): ComposeData {
  // ── Recipients ────────────────────────────────────────────────────────────
  // Gmail represents each recipient as a chip element with an `email` attribute
  // (stable) or a `data-hovercard-id` containing the email address.
  const chips = Array.from(
    composeEl.querySelectorAll<HTMLElement>(
      "[email], [data-hovercard-id]"
    )
  );

  const recipients = chips
    .map((chip) => {
      const email = chip.getAttribute("email");
      if (email) return email;
      const hovercard = chip.getAttribute("data-hovercard-id") ?? "";
      // data-hovercard-id may look like "email=alice@example.com" or just the email
      const match = hovercard.match(/([^\s=]+@[^\s]+)/);
      return match ? match[1] : null;
    })
    .filter((e): e is string => e !== null && e.includes("@"));

  // ── Subject ───────────────────────────────────────────────────────────────
  // Gmail uses <input name="subjectbox"> for the subject field.
  const subjectInput = composeEl.querySelector<HTMLInputElement>(
    'input[name="subjectbox"]'
  );
  const subject = subjectInput?.value ?? "";

  // ── Body HTML ─────────────────────────────────────────────────────────────
  // Gmail's compose body is a contenteditable div. We grab its innerHTML.
  // Multiple candidate selectors in priority order:
  const bodyEl =
    composeEl.querySelector<HTMLElement>('[contenteditable="true"]');
  const bodyHtml = bodyEl?.innerHTML ?? "";

  return { recipients, subject, bodyHtml };
}
