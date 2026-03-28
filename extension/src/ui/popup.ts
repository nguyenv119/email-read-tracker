/**
 * Hover popup for per-recipient tracking details.
 *
 * showPopup() renders a floating panel anchored near a checkmark span.
 * hidePopup() removes it. Only one popup exists in the DOM at a time.
 *
 * All user-supplied data (recipient, timestamps, user_agent) is rendered via
 * element.textContent to prevent XSS. No innerHTML interpolation of untrusted
 * values is used.
 */

import type { EmailTrackingRecord } from "../../../shared/src/types.js";

/** The id of the popup root element. */
export const POPUP_ID = "mailtrack-popup";

/**
 * Format an ISO-8601 timestamp to a human-readable local date+time string.
 */
function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Build a single popup row element for a tracking record using safe DOM APIs.
 * No user data is interpolated into HTML strings.
 */
function buildRowElement(r: EmailTrackingRecord): HTMLElement {
  const row = document.createElement("div");
  row.className = "mt-popup-row";

  const recipientSpan = document.createElement("span");
  recipientSpan.className = "mt-popup-recipient";
  recipientSpan.textContent = r.recipient;
  row.appendChild(recipientSpan);

  const openCount = r.opens.length;

  const countSpan = document.createElement("span");
  if (openCount === 0) {
    countSpan.className = "mt-popup-count mt-popup-count--zero";
    countSpan.textContent = "0 opens";
    row.appendChild(countSpan);
    return row;
  }

  const first = r.opens[0];
  const last = r.opens[openCount - 1];
  const countLabel = openCount === 1 ? "1 open" : `${openCount} opens`;

  countSpan.className = "mt-popup-count";
  countSpan.textContent = countLabel;
  row.appendChild(countSpan);

  const timesSpan = document.createElement("span");
  timesSpan.className = "mt-popup-times";
  timesSpan.textContent =
    openCount > 1
      ? `First: ${formatTs(first.timestamp)} Last: ${formatTs(last.timestamp)}`
      : `First: ${formatTs(first.timestamp)}`;
  row.appendChild(timesSpan);

  const uaSpan = document.createElement("span");
  uaSpan.className = "mt-popup-ua";
  uaSpan.textContent = last.user_agent;
  row.appendChild(uaSpan);

  return row;
}

/**
 * Build the popup inner container for a list of tracking records using safe
 * DOM construction. No innerHTML is used with user-supplied data.
 */
function buildPopupContent(records: EmailTrackingRecord[]): HTMLElement {
  const inner = document.createElement("div");
  inner.className = "mt-popup-inner";
  for (const r of records) {
    inner.appendChild(buildRowElement(r));
  }
  return inner;
}

/**
 * Show a popup positioned near `anchor` containing per-recipient open details.
 * Replaces any existing popup.
 */
export function showPopup(records: EmailTrackingRecord[], anchor: HTMLElement): void {
  // Remove existing popup if present.
  hidePopup();

  const popup = document.createElement("div");
  popup.id = POPUP_ID;
  popup.className = "mt-popup";
  popup.appendChild(buildPopupContent(records));

  document.body.appendChild(popup);

  // Position below the anchor element.
  const rect = anchor.getBoundingClientRect();
  popup.style.position = "fixed";
  popup.style.top = `${rect.bottom + 4}px`;
  popup.style.left = `${rect.left}px`;
  popup.style.zIndex = "99999";
}

/**
 * Remove the popup from the DOM. No-op if it is not present.
 */
export function hidePopup(): void {
  document.getElementById(POPUP_ID)?.remove();
}
