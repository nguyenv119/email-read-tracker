/**
 * Checkmark injection for the Gmail message list.
 *
 * observeMessageList() starts a MutationObserver on document.body. When new
 * DOM nodes are added, it scans them for Gmail message-list rows (tr[role="row"]),
 * extracts the subject text, looks up tracking records via getBySubject(), and
 * injects a checkmark span next to the sender name (after div.yW).
 *
 * Three-tier state:
 *   untracked — gray ✓ (.mt-checkmark base only)
 *   tracked   — green ✓ (.mt-checkmark.mt-checkmark--tracked)
 *   opened    — green ✓✓ (.mt-checkmark.mt-checkmark--opened)
 *
 * Every row receives a checkmark — untracked rows get a gray one so users can
 * see at a glance which emails are monitored.
 *
 * When a row is re-processed (e.g., after polling refreshes the cache), any
 * existing checkmark span is updated in-place rather than re-injected, so that
 * rows can be upgraded (gray → green, ✓ → ✓✓) without accumulating duplicate spans.
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
 * message list. This selector is used only for extracting the subject text
 * to look up tracking records — it is NOT the visual injection anchor.
 */
const SUBJECT_LOOKUP_SELECTOR = "span.bog";

/**
 * Gmail's sender name container in the message list. The checkmark span is
 * injected immediately after this element so it appears next to the sender
 * name rather than next to the subject text.
 */
const SENDER_ANCHOR_SELECTOR = "div.yW";

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
  const el = row.querySelector(SUBJECT_LOOKUP_SELECTOR);
  return el?.textContent?.trim() ?? null;
}

/** Possible tracking states for a Gmail row. */
type CheckmarkState = "untracked" | "tracked" | "opened";

/**
 * Determine the checkmark state for a set of tracking records.
 *   opened    — at least one recipient has opened the email
 *   tracked   — email was sent with tracking but no opens yet
 *   untracked — no tracking records found for this subject
 */
function checkmarkState(records: EmailTrackingRecord[]): CheckmarkState {
  if (records.length === 0) return "untracked";
  const anyOpened = records.some((r) => r.opens.length > 0);
  return anyOpened ? "opened" : "tracked";
}

/**
 * Build the innerHTML for a checkmark span. Always two checks (✓✓),
 * with color varying by state:
 *   untracked — both gray
 *   tracked   — first green, second gray (partial delivery indicator)
 *   opened    — both green
 */
function buildCheckmarkHTML(state: CheckmarkState): string {
  if (state === "opened") {
    return '<span class="mt-check mt-check--green">✓</span><span class="mt-check mt-check--green">✓</span>';
  }
  if (state === "tracked") {
    return '<span class="mt-check mt-check--green">✓</span><span class="mt-check mt-check--gray">✓</span>';
  }
  // untracked
  return '<span class="mt-check mt-check--gray">✓</span><span class="mt-check mt-check--gray">✓</span>';
}

/**
 * Return a string key representing the visual state, used for diffing
 * to decide if an existing checkmark needs updating.
 */
function checkmarkStateKey(state: CheckmarkState): string {
  return state;
}

/**
 * Inject a checkmark span into a row element. The checkmark is appended as the
 * last child of div.yW (the sender name container) so it appears to the RIGHT
 * of the sender name. Using appendChild instead of after() ensures it renders
 * inline with the name text rather than outside the container.
 * Attaches hover listeners for the popup only on tracked and opened rows —
 * gray (untracked) rows have no popup since there is no tracking data to display.
 */
function injectCheckmark(row: Element, state: CheckmarkState, records: EmailTrackingRecord[]): void {
  const senderAnchor = row.querySelector(SENDER_ANCHOR_SELECTOR);
  if (!senderAnchor) return;

  const span = document.createElement("span");
  span.setAttribute(CHECKMARK_ATTR, "true");
  span.setAttribute("data-mt-state", state);
  span.className = "mt-checkmark";
  span.innerHTML = buildCheckmarkHTML(state);

  if (state !== "untracked") {
    span.addEventListener("mouseenter", () => {
      showPopup(records, span as HTMLElement);
    });
    span.addEventListener("mouseleave", () => {
      hidePopup();
    });
  }

  senderAnchor.appendChild(span);
}

/**
 * Process a single DOM node: if it is (or contains) Gmail message-list rows,
 * inject or update checkmarks on every row.
 *
 * Every row receives a checkmark regardless of tracking state:
 *   - untracked rows get a gray ✓ (no popup)
 *   - tracked rows get a green ✓ (with popup)
 *   - opened rows get a green ✓✓ (with popup)
 *
 * For rows that already have a checkmark span, re-checks the current tracking
 * state and updates the span text and CSS class if the state changed
 * (untracked → tracked, tracked → opened). Popup listeners are also attached
 * when a row transitions from gray to green.
 *
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
    const state = checkmarkState(records);
    const existing = row.querySelector<HTMLElement>(`[${CHECKMARK_ATTR}]`);

    if (existing) {
      // Row already decorated — update in place if state changed.
      const currentState = existing.getAttribute("data-mt-state");
      if (currentState !== state) {
        existing.setAttribute("data-mt-state", state);
        existing.innerHTML = buildCheckmarkHTML(state);

        // Attach popup listeners when upgrading from untracked to tracked state.
        if (currentState === "untracked" && state !== "untracked") {
          existing.addEventListener("mouseenter", () => {
            showPopup(records, existing);
          });
          existing.addEventListener("mouseleave", () => {
            hidePopup();
          });
        }
      }
    } else {
      injectCheckmark(row, state, records);
    }
  }
}

/**
 * Re-process every Gmail message-list row currently in the document.
 * Called by content.ts after each successful poll so that rows already
 * rendered in the DOM are upgraded (gray → green, ✓ → ✓✓) when new
 * tracking data arrives, without waiting for a DOM mutation.
 */
export function rescanAllRows(): void {
  const rows = Array.from(document.querySelectorAll('tr[role="row"]'));
  for (const row of rows) {
    processNode(row);
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
