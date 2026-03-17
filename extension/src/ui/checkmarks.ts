/**
 * Checkmark injection for the Gmail message list.
 *
 * observeMessageList() starts a MutationObserver on document.body. When new
 * DOM nodes are added, it scans them for Gmail message-list rows (tr[role="row"]),
 * extracts the subject text, looks up tracking records via getBySubject(), and
 * injects a ✓ or ✓✓ span next to the subject.
 *
 * Matching strategy: subject text, because it is the only field present in both
 * the tracking data and the Gmail list-view DOM.
 */

import type { EmailTrackingRecord } from "../../../shared/src/types.js";
import { getBySubject } from "./poll.js";
import { showPopup, hidePopup } from "./popup.js";

/**
 * Data attribute placed on injected checkmark spans. Used both as a marker to
 * prevent duplicate injection and as a CSS selector target.
 */
export const CHECKMARK_ATTR = "data-mailtrack-checkmark";

/**
 * Gmail uses a span with class "bog" as the subject text element in the
 * message list. This selector targets it within a row.
 */
const SUBJECT_SELECTOR = "span.bog";

/**
 * Extract the plain-text subject from a Gmail message-list row element.
 * Returns null if no subject element is found.
 */
function extractSubject(row: Element): string | null {
  const el = row.querySelector(SUBJECT_SELECTOR);
  return el?.textContent?.trim() ?? null;
}

/**
 * Determine the checkmark text for a set of tracking records.
 * ✓✓ if any record has at least one open; ✓ otherwise.
 */
function checkmarkText(records: EmailTrackingRecord[]): string {
  const anyOpened = records.some((r) => r.opens.length > 0);
  return anyOpened ? "✓✓" : "✓";
}

/**
 * Inject a checkmark span into a row element. Attaches hover listeners for
 * the popup.
 */
function injectCheckmark(row: Element, records: EmailTrackingRecord[]): void {
  const subjectEl = row.querySelector(SUBJECT_SELECTOR);
  if (!subjectEl) return;

  const span = document.createElement("span");
  span.setAttribute(CHECKMARK_ATTR, "true");
  span.className = "mt-checkmark";
  span.textContent = checkmarkText(records);

  span.addEventListener("mouseenter", () => {
    showPopup(records, span as HTMLElement);
  });
  span.addEventListener("mouseleave", () => {
    hidePopup();
  });

  subjectEl.after(span);
}

/**
 * Process a single DOM node: if it is (or contains) Gmail message-list rows,
 * inject checkmarks for any tracked subjects.
 */
function processNode(node: Node): void {
  if (!(node instanceof Element)) return;

  // The node itself may be a row, or may contain rows.
  const rows: Element[] = [];
  if (node.matches('tr[role="row"]')) {
    rows.push(node);
  } else {
    rows.push(...Array.from(node.querySelectorAll('tr[role="row"]')));
  }

  for (const row of rows) {
    // Skip rows already decorated.
    if (row.querySelector(`[${CHECKMARK_ATTR}]`)) continue;

    const subject = extractSubject(row);
    if (!subject) continue;

    const records = getBySubject(subject);
    if (records.length === 0) continue;

    injectCheckmark(row, records);
  }
}

/**
 * Start a MutationObserver on document.body that processes newly added nodes.
 * Safe to call multiple times — each call creates a separate observer, so
 * content.ts should call it only once.
 */
export function observeMessageList(): void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        processNode(node);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
