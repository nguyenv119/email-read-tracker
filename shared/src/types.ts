/**
 * Shared TypeScript types for @mailtrack/shared.
 * Consumed by both the backend Lambda and the Chrome extension.
 */

/** Core metadata stored per tracked email recipient. */
export interface EmailMetadata {
  /** Unique identifier for the tracking pixel embedded in the email. */
  pixel_id: string;
  /** Groups all recipients of the same email send together. */
  email_group_id: string;
  /** Recipient email address. */
  recipient: string;
  /** Email subject line. */
  subject: string;
  /** ISO-8601 datetime when the email was sent. */
  sent_at: string;
}

/** A single open event recorded when the tracking pixel is loaded. */
export interface OpenEvent {
  /** ISO-8601 datetime when the pixel was loaded. */
  timestamp: string;
  /** IP address of the request, for rough geolocation. */
  ip: string;
  /** User-Agent header from the pixel request. */
  user_agent: string;
}

/** Request body for POST /emails — registers a batch of tracked recipients. */
export interface CreateEmailRequest {
  /** Groups all recipients of this send together. */
  email_group_id: string;
  /** One entry per recipient; each has its own unique pixel. */
  recipients: { email: string; pixel_id: string }[];
  /** Email subject line. */
  subject: string;
  /** ISO-8601 datetime when the email was sent. */
  sent_at: string;
}

/** Full tracking record returned by GET /emails — metadata plus all open events. */
export type EmailTrackingRecord = EmailMetadata & {
  /** All recorded open events for this recipient, in order of occurrence. */
  opens: OpenEvent[];
};
