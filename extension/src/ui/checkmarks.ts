/**
 * Checkmark injection for the Gmail message list.
 *
 * observeMessageList() starts a MutationObserver on document.body. When new
 * DOM nodes are added, it scans them for Gmail message-list rows (tr[role="row"]),
 * extracts the subject text, looks up tracking records via getBySubject(), and
 * injects a ✓ or ✓✓ span next to the subject.
 *
 * When a row is re-processed (e.g., after polling refreshes the cache), any
 * existing checkmark span is updated in-place rather than re-injected, so that
 * ✓ rows can be upgraded to ✓✓ without accumulating duplicate spans.
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

/** Module-level guard: true once observeMessageList() has been called. */
let observing = false;

/**
 * Reset the observing guard. Exposed for tests only — allows each test to call
 * observeMessageList() as if it were the first call.
 *
 * @internal
 */
export function _resetObservingForTest(): void {
  observing = false;
}

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
 * inject or update checkmarks for any tracked subjects.
 *
 * For rows that already have a checkmark span, re-checks the current tracking
 * state and updates the span text/class if the status changed (✓ → ✓✓).
 * Only skips a row entirely when the existing checkmark already matches the
 * current state.
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
    const subject = extractSubject(row);
    if (!subject) continue;

    const records = getBySubject(subject);
    if (records.length === 0) continue;

    const desired = checkmarkText(records);
    const existing = row.querySelector<HTMLElement>(`[${CHECKMARK_ATTR}]`);

    if (existing) {
      // Row already decorated — update in place only if the status changed.
      if (existing.textContent !== desired) {
        existing.textContent = desired;
      }
    } else {
      injectCheckmark(row, records);
    }
  }
}

/**
 * Start a MutationObserver on document.body that processes newly added nodes.
 * Safe to call multiple times — subsequent calls after the first are no-ops,
 * preventing observer leaks on re-navigation.
 */
export function observeMessageList(): void {
  if (observing) return;
  observing = true;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        processNode(node);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
