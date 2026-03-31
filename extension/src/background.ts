/**
 * Background service worker for the MailTrack Chrome extension.
 *
 * Runs as a Manifest V3 service worker. Acts as the message bus between the
 * content script (running in the Gmail tab) and the backend tracking API.
 * ! When content.ts calls chrome.runtime.sendMessage(...), Chrome invokes this handler.
 */

import { getAuthTokenInBackground } from "./gmail/auth.js";

export function handleMessage(
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): boolean | undefined {
  if (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: string }).type === "GET_AUTH_TOKEN"
  ) {
    // chrome.identity.getAuthToken is only available in the service worker.
    // We relay the token back to the content script via sendResponse.
    getAuthTokenInBackground()
      .then((token) => sendResponse({ token }))
      .catch((err) => {
        console.error("[MailTrack] getAuthToken failed:", err);
        sendResponse({ token: undefined });
      });

    // Return true to keep the message channel open for the async response.
    return true;
  }
}

chrome.runtime.onMessage.addListener(handleMessage);
