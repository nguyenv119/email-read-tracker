import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("ntfy", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    process.env["NTFY_TOPIC"] = "test-topic";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["NTFY_TOPIC"];
  });

  it("posts a message to the correct ntfy.sh topic URL", async () => {
    /**
     * Verifies that notifyOpen() sends a POST request to
     * https://ntfy.sh/{NTFY_TOPIC} with the pixel_id and recipient in the body.
     *
     * This matters because ntfy.sh is the notification channel — the URL must
     * match the topic the user subscribed to. A wrong URL silently drops every
     * notification, meaning the user never sees email opens.
     *
     * If this contract breaks, the user receives zero open notifications even
     * though tracking pixels load successfully.
     */
    // REVIEW: mocking core dependency — test may not reflect real behavior
    const { notifyOpen } = await import("../ntfy.js");
    await notifyOpen("pixel-abc-123", "recipient@example.com");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ntfy.sh/test-topic");
    expect(init.method).toBe("POST");
  });

  it("includes pixel_id and recipient in the notification body", async () => {
    /**
     * Verifies that the notification message body contains the pixel_id and
     * recipient so the user can identify which email was opened by whom.
     *
     * Without this information the notification is useless — the user can't
     * tell which tracked email triggered the alert.
     *
     * If this contract breaks, every notification says something generic like
     * "email opened" with no identifying information.
     */
    // REVIEW: mocking core dependency — test may not reflect real behavior
    const { notifyOpen } = await import("../ntfy.js");
    await notifyOpen("px-999", "alice@example.com");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = String(init.body);
    expect(body).toContain("px-999");
    expect(body).toContain("alice@example.com");
  });

  it("throws when the ntfy.sh HTTP response is not ok (non-2xx status)", async () => {
    /**
     * Verifies that notifyOpen() throws an Error when the ntfy.sh server
     * returns a non-2xx response (e.g., 403 Forbidden or 429 Too Many Requests)
     * rather than silently swallowing the failure.
     *
     * This matters because a silent failure means the operator has no signal
     * that notifications are broken. If ntfy.sh rejects requests (rate-limit,
     * auth failure, wrong topic), the user should see an error in logs rather
     * than believing notifications are working.
     *
     * If this contract breaks, failed notification deliveries are silently
     * dropped and the operator has no way to detect the outage.
     */
    // REVIEW: mocking core dependency — test may not reflect real behavior
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 });
    vi.resetModules();
    const { notifyOpen } = await import("../ntfy.js");

    await expect(notifyOpen("px-1", "user@example.com")).rejects.toThrow();
  });

  it("URL-encodes the topic when constructing the ntfy.sh URL", async () => {
    /**
     * Verifies that notifyOpen() percent-encodes the NTFY_TOPIC value before
     * interpolating it into the URL, so topics with special characters (spaces,
     * slashes, etc.) produce a valid URL rather than a malformed one.
     *
     * This matters because an unencoded special character in the URL path
     * (e.g., a space or slash) causes the HTTP request to target the wrong
     * resource or fail with a parse error, silently dropping the notification.
     *
     * If this contract breaks, any topic name containing special characters
     * causes all notifications to be silently dropped or routed incorrectly.
     */
    // REVIEW: mocking core dependency — test may not reflect real behavior
    process.env["NTFY_TOPIC"] = "my topic/with spaces";
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    vi.resetModules();
    const { notifyOpen } = await import("../ntfy.js");

    await notifyOpen("px-1", "user@example.com");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://ntfy.sh/my%20topic%2Fwith%20spaces");
  });

  it("throws when NTFY_TOPIC env var is missing", async () => {
    /**
     * Verifies that notifyOpen() throws a descriptive error when the required
     * NTFY_TOPIC environment variable is not set, rather than silently posting
     * to "https://ntfy.sh/undefined".
     *
     * This matters because a missing env var is a deployment misconfiguration.
     * Failing loudly surfaces the problem immediately during testing/deploy;
     * failing silently means notifications go to the wrong topic forever.
     *
     * If this contract breaks, a misconfigured Lambda posts to a nonsense URL
     * and the user receives no notifications without any error being logged.
     */
    delete process.env["NTFY_TOPIC"];
    // Re-import to get a fresh module without cached env
    vi.resetModules();
    const { notifyOpen } = await import("../ntfy.js");
    await expect(notifyOpen("px-1", "bob@example.com")).rejects.toThrow(
      /NTFY_TOPIC/
    );
  });
});
