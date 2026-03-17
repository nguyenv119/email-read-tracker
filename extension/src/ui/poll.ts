/**
 * Polling module for the tracking UI.
 *
 * Fetches GET /emails from the backend every POLL_INTERVAL_MS milliseconds
 * and maintains a cache of EmailTrackingRecord[] grouped by email_group_id.
 *
 * Other modules read from the cache synchronously via getCache() /
 * getBySubject() — no awaiting needed at render time.
 */

import type { EmailTrackingRecord } from "../../../shared/src/types.js";
import { BACKEND_URL } from "../config.js";

export const POLL_INTERVAL_MS = 30_000;

/**
 * Cache: email_group_id → EmailTrackingRecord[]
 * All recipients belonging to the same compose action share an email_group_id.
 */
const cache = new Map<string, EmailTrackingRecord[]>();

let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Fetch /emails and rebuild the cache. Errors are swallowed so a transient
 * network failure never crashes the content script.
 */
async function poll(): Promise<void> {
  try {
    const res = await fetch(`${BACKEND_URL}/emails`);
    if (!res.ok) return;

    const records: EmailTrackingRecord[] = await res.json();

    // Rebuild cache from scratch on each successful fetch so deletions / edits
    // on the backend are reflected correctly.
    cache.clear();
    for (const record of records) {
      const group = cache.get(record.email_group_id) ?? [];
      group.push(record);
      cache.set(record.email_group_id, group);
    }
  } catch {
    // Swallow network errors — stale cache is better than crashing.
  }
}

/**
 * Start the polling interval. Fires immediately and then every
 * POLL_INTERVAL_MS. Calling startPolling() while already polling is a no-op
 * (the existing interval is not replaced).
 */
export function startPolling(): void {
  if (intervalId !== null) return;
  // Fire immediately, then on interval.
  void poll();
  intervalId = setInterval(() => void poll(), POLL_INTERVAL_MS);
}

/**
 * Cancel the polling interval. Safe to call even if polling has not been started.
 */
export function stopPolling(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/**
 * Return the raw cache map. Primarily for testing.
 */
export function getCache(): Map<string, EmailTrackingRecord[]> {
  return cache;
}

/**
 * Clear the cache. Used in tests to reset state between runs.
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Return all tracking records whose subject matches `subject` (exact match).
 * Returns an empty array when no records match.
 */
export function getBySubject(subject: string): EmailTrackingRecord[] {
  const results: EmailTrackingRecord[] = [];
  for (const records of cache.values()) {
    for (const record of records) {
      if (record.subject === subject) {
        results.push(record);
      }
    }
  }
  return results;
}
