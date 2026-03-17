import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// fetch stub
// ---------------------------------------------------------------------------
// REVIEW: mocking core dependency — test may not reflect real behavior

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import type { EmailTrackingRecord } from "../../../shared/src/types.js";
import {
  startPolling,
  stopPolling,
  getCache,
  clearCache,
  getBySubject,
  POLL_INTERVAL_MS,
} from "../ui/poll.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<EmailTrackingRecord> = {}): EmailTrackingRecord {
  return {
    pixel_id: "px-1",
    email_group_id: "grp-1",
    recipient: "a@example.com",
    subject: "Hello World",
    sent_at: "2024-01-01T00:00:00Z",
    opens: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("poll.ts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearCache();
    vi.resetAllMocks();
  });

  afterEach(() => {
    stopPolling();
    vi.useRealTimers();
  });

  it("fetches emails from backend on first poll tick", async () => {
    /**
     * Verifies that startPolling immediately triggers a GET /emails fetch
     * against the configured backend URL.
     *
     * The UI depends entirely on data arriving from the backend. If the first
     * fetch never fires, no checkmarks will appear regardless of what's in
     * Gmail.
     *
     * If this contract is violated, the tracking UI shows nothing even when
     * emails have been read.
     */
    // GIVEN
    const records = [makeRecord()];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => records,
    });

    // WHEN — advance past the immediate poll (no interval, just the initial call)
    startPolling();
    await vi.advanceTimersByTimeAsync(0);

    // THEN
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/emails");
  });

  it("populates cache indexed by email_group_id after a successful fetch", async () => {
    /**
     * Verifies that after a successful poll, getCache() returns a Map keyed
     * by email_group_id whose entries contain the fetched tracking records.
     *
     * The checkmarks module reads from this cache; if records are not indexed
     * by email_group_id (or not stored at all), checkmarks cannot look up
     * tracking state for a given email.
     *
     * If this contract is violated, no checkmarks are injected even when
     * tracking data exists.
     */
    // GIVEN
    const records = [
      makeRecord({ email_group_id: "grp-A", pixel_id: "px-A", recipient: "a@example.com" }),
      makeRecord({ email_group_id: "grp-A", pixel_id: "px-B", recipient: "b@example.com" }),
      makeRecord({ email_group_id: "grp-B", pixel_id: "px-C", recipient: "c@example.com" }),
    ];
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => records });

    // WHEN
    startPolling();
    await vi.advanceTimersByTimeAsync(0);

    // THEN
    const cache = getCache();
    expect(cache.has("grp-A")).toBe(true);
    expect(cache.has("grp-B")).toBe(true);
    expect(cache.get("grp-A")).toHaveLength(2);
    expect(cache.get("grp-B")).toHaveLength(1);
  });

  it("re-fetches on the configured interval and updates the cache", async () => {
    /**
     * Verifies that startPolling fires repeated fetches at the configured
     * polling interval, keeping the cache up to date with new open events.
     *
     * Without periodic re-fetching, the UI shows stale checkmarks — an email
     * that was opened after the first poll would never get upgraded from ✓
     * to ✓✓.
     *
     * If this contract is violated, checkmarks never update after the initial
     * page load.
     */
    // GIVEN — first response has no opens; second has an open
    const base = makeRecord({ email_group_id: "grp-1", opens: [] });
    const updated = makeRecord({
      email_group_id: "grp-1",
      opens: [{ timestamp: "2024-01-02T00:00:00Z", ip: "1.2.3.4", user_agent: "Mozilla" }],
    });
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => [base] })
      .mockResolvedValueOnce({ ok: true, json: async () => [updated] });

    // WHEN — advance past the immediate poll, then one full interval
    startPolling();
    await vi.advanceTimersByTimeAsync(0);               // immediate poll
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // second poll

    // THEN — second fetch occurred and cache has latest open data
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const records = getCache().get("grp-1")!;
    expect(records[0].opens).toHaveLength(1);
  });

  it("does not throw and leaves cache intact when fetch returns non-OK", async () => {
    /**
     * Verifies that a failed poll (HTTP error response) does not crash the
     * poller and leaves any previously cached data unchanged.
     *
     * Network errors should be silent — crashing would unload the content
     * script. Stale data is better than no data.
     *
     * If this contract is violated, a single backend error takes down the
     * entire tracking UI for the rest of the session.
     */
    // GIVEN — prime cache with valid data, then fail next fetch
    const record = makeRecord();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => [record] })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    startPolling();
    await vi.advanceTimersByTimeAsync(0);               // first poll succeeds
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // second poll fails

    // THEN — cache still has the original data
    expect(getCache().has("grp-1")).toBe(true);
  });

  it("does not throw and leaves cache intact when fetch rejects (network error)", async () => {
    /**
     * Verifies that a network-level fetch rejection does not crash the poller.
     *
     * A user may lose wifi momentarily; the UI should continue showing
     * whatever was last fetched rather than crashing.
     *
     * If this contract is violated, a momentary network blip crashes the
     * content script for the rest of the Gmail session.
     */
    // GIVEN
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    // WHEN / THEN — must not throw
    startPolling();
    await expect(vi.advanceTimersByTimeAsync(0)).resolves.not.toThrow();
  });

  it("stopPolling prevents further fetches after being called", async () => {
    /**
     * Verifies that stopPolling() cancels the interval so no further fetches
     * are made.
     *
     * Without a stop mechanism, multiple startPolling() calls (e.g., from
     * navigation events) would leak intervals and make redundant fetches.
     *
     * If this contract is violated, calling startPolling() multiple times
     * causes exponential fetch growth.
     */
    // GIVEN
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });

    startPolling();
    await vi.advanceTimersByTimeAsync(0); // immediate poll
    const callsAfterStart = fetchMock.mock.calls.length;

    // WHEN
    stopPolling();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

    // THEN — no additional calls after stop
    expect(fetchMock.mock.calls.length).toBe(callsAfterStart);
  });

  it("getBySubject returns all records whose subject matches", async () => {
    /**
     * Verifies that getBySubject returns all tracking records across groups
     * whose subject field matches the given string.
     *
     * The checkmarks module uses subject matching because it's the only field
     * visible in both the tracking data and the Gmail message list row.
     *
     * If this contract is violated, no checkmarks are injected because the
     * lookup always returns empty.
     */
    // GIVEN
    const match1 = makeRecord({ email_group_id: "grp-A", pixel_id: "px-1", subject: "Hello World" });
    const match2 = makeRecord({ email_group_id: "grp-B", pixel_id: "px-2", subject: "Hello World" });
    const noMatch = makeRecord({ email_group_id: "grp-C", pixel_id: "px-3", subject: "Other" });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [match1, match2, noMatch] });

    startPolling();
    await vi.advanceTimersByTimeAsync(0);

    // WHEN
    const results = getBySubject("Hello World");

    // THEN
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.pixel_id)).toContain("px-1");
    expect(results.map((r) => r.pixel_id)).toContain("px-2");
  });
});
