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
