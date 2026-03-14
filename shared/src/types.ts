/** Per-recipient tracking metadata stored in DynamoDB. */
export interface EmailMetadata {
  /** DynamoDB PK — also embedded as the pixel img src */
  pixel_id: string;
  /** Groups all recipients of the same compose action */
  email_group_id: string;
  recipient: string;
  subject: string;
  /** ISO-8601 */
  sent_at: string;
}

/** Logged each time the tracking pixel is fetched. */
export interface OpenEvent {
  /** ISO-8601 */
  timestamp: string;
  ip: string;
  user_agent: string;
}

/** POST /emails request body — registers a batch of tracked recipients. */
export interface CreateEmailRequest {
  email_group_id: string;
  recipients: { email: string; pixel_id: string }[];
  subject: string;
  /** ISO-8601 */
  sent_at: string;
}

/** GET /emails response item — metadata plus open history. */
export type EmailTrackingRecord = EmailMetadata & {
  opens: OpenEvent[];
};
