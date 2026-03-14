/**
 * Background service worker for the MailTrack Chrome extension.
 *
 * Runs as a Manifest V3 service worker. Acts as the message bus between the
 * content script (running in the Gmail tab) and the backend tracking API.
 */

chrome.runtime.onMessage.addListener(
  (
    _message: unknown,
    _sender: chrome.runtime.MessageSender,
    _sendResponse: (response?: unknown) => void
  ) => {
    // TODO: handle messages from content script (e.g. send tracking data to backend)
  }
);

export {};
