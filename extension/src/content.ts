/**
 * Content script for the MailTrack Chrome extension.
 *
 * Injected into every *://mail.google.com/* page. Uses observeComposeWindows
 * from intercept.ts to watch the Gmail DOM for compose-window elements and
 * intercept the send button to inject tracking pixels per recipient.
 */

import { observeComposeWindows } from "./gmail/intercept.js";

observeComposeWindows();

export {};
