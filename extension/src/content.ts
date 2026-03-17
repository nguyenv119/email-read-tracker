/**
 * Content script for the MailTrack Chrome extension.
 *
 * Injected into every *://mail.google.com/* page. Bootstraps three subsystems:
 *
 *  1. observeComposeWindows — intercepts Gmail send buttons to inject per-
 *     recipient tracking pixels (existing functionality).
 *
 *  2. startPolling — begins periodic GET /emails fetches from the backend,
 *     keeping the local cache of EmailTrackingRecord[] up to date.
 *
 *  3. observeMessageList — watches Gmail's message-list DOM for new rows and
 *     injects ✓ / ✓✓ checkmarks on rows whose subject matches tracked emails.
 *
 * CSS is injected programmatically so that esbuild can bundle everything from
 * this single entry point without requiring a separate CSS loader.
 */

import { observeComposeWindows } from "./gmail/intercept.js";
import { startPolling } from "./ui/poll.js";
import { observeMessageList } from "./ui/checkmarks.js";

// ---------------------------------------------------------------------------
// CSS injection
// ---------------------------------------------------------------------------
// styles.css is read as a raw string at bundle time via the ?inline query.
// We inject it as a <style> element so the browser applies it to the page.
// Using a raw import avoids the need for a separate CSS entry point in
// esbuild's --bundle invocation.
// ---------------------------------------------------------------------------

const CSS = `
/* MailTrack — tracking UI styles */
.mt-checkmark {
  display: inline-block;
  margin-left: 4px;
  font-size: 11px;
  font-weight: bold;
  cursor: default;
  user-select: none;
  vertical-align: middle;
  line-height: 1;
  color: #9e9e9e;
}
.mt-checkmark--opened {
  color: #1a73e8;
}
.mt-popup {
  background: #ffffff;
  border: 1px solid #dadce0;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.15);
  min-width: 280px;
  max-width: 480px;
  padding: 8px 0;
  font-family: Google Sans, Roboto, Arial, sans-serif;
  font-size: 13px;
  color: #202124;
}
.mt-popup-inner { padding: 0 12px; }
.mt-popup-row {
  padding: 6px 0;
  border-bottom: 1px solid #f1f3f4;
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas: "recipient count" "times times" "ua ua";
  gap: 2px 8px;
  align-items: baseline;
}
.mt-popup-row:last-child { border-bottom: none; }
.mt-popup-recipient { grid-area: recipient; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt-popup-count { grid-area: count; font-size: 12px; color: #1a73e8; white-space: nowrap; }
.mt-popup-count--zero { color: #9e9e9e; }
.mt-popup-times { grid-area: times; font-size: 11px; color: #5f6368; line-height: 1.4; }
.mt-popup-ua { grid-area: ua; font-size: 11px; color: #80868b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

function injectStyles(): void {
  const style = document.createElement("style");
  style.id = "mailtrack-styles";
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

injectStyles();
observeComposeWindows();
startPolling();
observeMessageList();

export {};
