/**
 * Hover popup for per-recipient tracking details.
 *
 * showPopup() renders a floating panel anchored near a checkmark span.
 * hidePopup() removes it. Only one popup exists in the DOM at a time.
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
 * Build the popup HTML content for a list of tracking records.
 */
function buildPopupHtml(records: EmailTrackingRecord[]): string {
  const rows = records
    .map((r) => {
      const openCount = r.opens.length;
      if (openCount === 0) {
        return `
          <div class="mt-popup-row">
            <span class="mt-popup-recipient">${r.recipient}</span>
            <span class="mt-popup-count mt-popup-count--zero">0 opens</span>
          </div>`;
      }
      const first = r.opens[0];
      const last = r.opens[r.opens.length - 1];
      const countLabel = openCount === 1 ? "1 open" : `${openCount} opens`;
      const firstTs = formatTs(first.timestamp);
      const lastTs = openCount > 1 ? `<br/>Last: ${formatTs(last.timestamp)}` : "";
      return `
          <div class="mt-popup-row">
            <span class="mt-popup-recipient">${r.recipient}</span>
            <span class="mt-popup-count">${countLabel}</span>
            <span class="mt-popup-times">First: ${firstTs}${lastTs}</span>
            <span class="mt-popup-ua">${last.user_agent}</span>
          </div>`;
    })
    .join("");

  return `<div class="mt-popup-inner">${rows}</div>`;
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
  popup.innerHTML = buildPopupHtml(records);

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
