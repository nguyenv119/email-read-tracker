/**
 * Content script for the MailTrack Chrome extension.
 *
 * Injected into every *://mail.google.com/* page. Uses a MutationObserver
 * to watch the Gmail DOM for compose-window elements so tracking pixels can
 * be injected before the email is sent.
 */

const observer = new MutationObserver((_mutations: MutationRecord[]) => {
  // TODO: detect compose window opening and inject tracking pixel
});

observer.observe(document.body, { subtree: true, childList: true });

export {};
