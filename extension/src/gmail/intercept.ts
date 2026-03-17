/**
 * Gmail compose-window intercept.
 *
 * Uses a MutationObserver to detect when Gmail adds a compose window to the
 * DOM. When found, it attaches a click listener to the send button that:
 *  1. Calls preventDefault() and stopImmediatePropagation() to suppress the
 *     default Gmail send action.
 *  2. Reads the compose fields (recipients, subject, body) via compose.ts.
 *  3. Obtains an OAuth token via auth.ts (routed through background.ts).
 *  4. Sends individualized tracked copies via send.ts.
 *
 * Gmail send button selectors (data attributes are stable across obfuscation):
 *  - [data-tooltip*="Send"]  — standard compose window (Gmail uses div[role="button"], not <button>)
 *  - [aria-label*="Send"]    — accessibility-mode fallback
 */

import { readCompose } from "./compose.js";
import { sendTrackedEmails } from "./send.js";
import { getAuthToken } from "./auth.js";

/**
 * CSS selectors that match Gmail's send button. Listed in priority order.
 * Note: Gmail renders send buttons as div[role="button"], not <button> elements,
 * so these selectors intentionally omit the element-type prefix.
 */
const SEND_BUTTON_SELECTORS = [
  '[data-tooltip*="Send"]',
  '[aria-label*="Send"]',
];

/**
 * Find all send buttons within a root element.
 */
function findSendButtons(root: Element | Document): HTMLElement[] {
  const results: HTMLElement[] = [];
  for (const sel of SEND_BUTTON_SELECTORS) {
    results.push(...Array.from(root.querySelectorAll<HTMLElement>(sel)));
  }
  // De-duplicate in case an element matches multiple selectors
  return [...new Set(results)];
}

/**
 * Find the compose window ancestor of a send button.
 * Falls back to the button's parentElement if no known container is found.
 */
function findComposeWindow(btn: HTMLElement): Element {
  // Walk up looking for a known compose container.
  // Gmail compose windows are typically inside a div with role="dialog"
  // or a div that contains the subjectbox input.
  let el: Element | null = btn;
  while (el) {
    if (
      el.querySelector('input[name="subjectbox"]') ||
      el.getAttribute("role") === "dialog"
    ) {
      return el;
    }
    el = el.parentElement;
  }
  // Fallback: no recognised ancestor found; use parentElement or document root.
  return btn.parentElement ?? document.documentElement;
}

/**
 * Attach a send-intercept click listener to an element.
 * Idempotent: if already attached, the data attribute guard prevents double-attaching.
 */
function attachSendListener(btn: HTMLElement): void {
  if (btn.dataset["mailtrackAttached"] === "1") return;
  btn.dataset["mailtrackAttached"] = "1";

  btn.addEventListener(
    "click",
    (event: MouseEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const composeEl = findComposeWindow(btn);
      const compose = readCompose(composeEl);

      if (compose.recipients.length === 0) {
        // No recipients — let user know, don't send anything
        console.warn("[MailTrack] No recipients found in compose window");
        return;
      }

      // Obtain token and send asynchronously.
      // We intentionally don't await here so the click handler returns
      // synchronously (required for stopImmediatePropagation to work).
      getAuthToken()
        .then((token) =>
          sendTrackedEmails({
            token,
            recipients: compose.recipients,
            subject: compose.subject,
            bodyHtml: compose.bodyHtml,
          })
        )
        .catch((err: unknown) => {
          console.error("[MailTrack] Send failed:", err);
        });
    },
    true // capture phase — fires before Gmail's own listeners
  );
}

/**
 * Start observing the Gmail DOM for compose windows.
 * Call this once when the content script initialises.
 */
export function observeComposeWindows(): void {
  const observer = new MutationObserver((mutations: MutationRecord[]) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (!(node instanceof Element)) continue;

        // The added node itself might be a send button
        if (node instanceof HTMLElement) {
          for (const sel of SEND_BUTTON_SELECTORS) {
            if (node.matches(sel)) {
              attachSendListener(node);
            }
          }
        }

        // Or the added node might contain send buttons
        const buttons = findSendButtons(node);
        for (const btn of buttons) {
          attachSendListener(btn);
        }
      }
    }
  });

  observer.observe(document.body, { subtree: true, childList: true });
}
