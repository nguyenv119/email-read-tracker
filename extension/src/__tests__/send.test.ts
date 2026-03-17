import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// fetch stub
// ---------------------------------------------------------------------------
// REVIEW: mocking core dependency — test may not reflect real behavior

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// crypto.randomUUID is available in jsdom/Node — no stub needed.

import { sendTrackedEmails } from "../gmail/send.js";

// ---------------------------------------------------------------------------
// Tests for send.ts
// ---------------------------------------------------------------------------

/**
 * Default fetch handler: responds to the Gmail profile URL with a real email
 * address, and to all other URLs with the provided response shape.
 */
function makeDefaultFetchMock(
  gmailResponse: { id: string; threadId: string } = { id: "msg1", threadId: "thread1" }
) {
  return vi.fn(async (url: string) => {
    if ((url as string).includes("users/me/profile")) {
      return { ok: true, json: async () => ({ emailAddress: "sender@example.com" }) };
    }
    return { ok: true, json: async () => gmailResponse };
  });
}

describe("sendTrackedEmails", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls gmail API once per recipient", async () => {
    /**
     * Verifies that sendTrackedEmails makes one gmail.users.messages.send
     * call per recipient so each copy carries a unique tracking pixel.
     *
     * The entire point of the extension is individualized tracking — sending
     * a single group email would make it impossible to attribute an open to a
     * specific recipient.
     *
     * If this contract is violated, only one email is sent (to one recipient)
     * and the others receive nothing.
     */
    // GIVEN
    fetchMock.mockImplementation(makeDefaultFetchMock());

    // WHEN
    await sendTrackedEmails({
      token: "tok",
      recipients: ["a@example.com", "b@example.com"],
      subject: "Hi",
      bodyHtml: "<p>Hello</p>",
    });

    // THEN
    // 2 Gmail send API calls (one per recipient) — profile and backend POST excluded
    const gmailSendCalls = fetchMock.mock.calls.filter((c: unknown[]) =>
      (c[0] as string).includes("messages/send")
    );
    expect(gmailSendCalls).toHaveLength(2);
  });

  it("injects a unique tracking pixel into each recipient's body", async () => {
    /**
     * Verifies that the body sent to each recipient contains an <img> tag
     * with the pixel endpoint URL so the backend can record opens.
     *
     * Without the pixel the backend never learns the email was opened —
     * the extension would send email but never track anything.
     *
     * If this contract is violated, the extension delivers emails but
     * the dashboard always shows zero opens.
     */
    // GIVEN
    const bodies: string[] = [];
    fetchMock.mockImplementation(async (url: string, opts: RequestInit) => {
      if ((url as string).includes("users/me/profile")) {
        return { ok: true, json: async () => ({ emailAddress: "sender@example.com" }) };
      }
      if ((url as string).includes("gmail.googleapis.com")) {
        // capture raw MIME body
        const parsed = JSON.parse(opts.body as string) as { raw: string };
        bodies.push(atob(parsed.raw.replace(/-/g, "+").replace(/_/g, "/")));
        return { ok: true, json: async () => ({ id: "m", threadId: "t" }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    // WHEN
    await sendTrackedEmails({
      token: "tok",
      recipients: ["a@example.com"],
      subject: "Hi",
      bodyHtml: "<p>Hello</p>",
    });

    // THEN
    expect(bodies[0]).toMatch(/emailTrack\//);
    expect(bodies[0]).toMatch(/<img/);
  });

  it("each recipient gets a different pixel_id", async () => {
    /**
     * Verifies that pixel_ids are unique across recipients so the backend
     * can attribute an open to the correct individual.
     *
     * Reusing a pixel_id across recipients would conflate opens — every open
     * by recipient A would also appear as an open by recipient B.
     *
     * If this contract is violated, open attribution is entirely wrong and
     * the tracking dashboard is unreliable.
     */
    // GIVEN
    const pixelIds: string[] = [];
    fetchMock.mockImplementation(async (url: string, opts: RequestInit) => {
      if ((url as string).includes("users/me/profile")) {
        return { ok: true, json: async () => ({ emailAddress: "sender@example.com" }) };
      }
      if ((url as string).includes("gmail.googleapis.com")) {
        const parsed = JSON.parse(opts.body as string) as { raw: string };
        const mime = atob(parsed.raw.replace(/-/g, "+").replace(/_/g, "/"));
        const match = mime.match(/emailTrack\/([a-f0-9-]+)/i);
        if (match) pixelIds.push(match[1]);
        return { ok: true, json: async () => ({ id: "m", threadId: "t" }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    // WHEN
    await sendTrackedEmails({
      token: "tok",
      recipients: ["a@example.com", "b@example.com"],
      subject: "Hi",
      bodyHtml: "<p>Hello</p>",
    });

    // THEN
    expect(pixelIds).toHaveLength(2);
    expect(pixelIds[0]).not.toBe(pixelIds[1]);
  });

  it("subsequent recipients reuse the threadId from the first send", async () => {
    /**
     * Verifies that after the first Gmail send returns a threadId, subsequent
     * sends include that same threadId so all copies appear as one thread.
     *
     * Without threading, each recipient's copy becomes a separate conversation
     * in the sender's Gmail, making sent-mail unmanageable.
     *
     * If this contract is violated, the sender sees N separate threads in
     * Sent Mail instead of one grouped thread.
     */
    // GIVEN
    const requestBodies: Array<{ threadId?: string }> = [];
    fetchMock.mockImplementation(async (url: string, opts: RequestInit) => {
      if ((url as string).includes("users/me/profile")) {
        return { ok: true, json: async () => ({ emailAddress: "sender@example.com" }) };
      }
      if ((url as string).includes("gmail.googleapis.com")) {
        requestBodies.push(JSON.parse(opts.body as string) as { threadId?: string });
        return {
          ok: true,
          json: async () => ({ id: "m", threadId: "thread_shared" }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    // WHEN
    await sendTrackedEmails({
      token: "tok",
      recipients: ["a@example.com", "b@example.com"],
      subject: "Hi",
      bodyHtml: "<p>Hello</p>",
    });

    // THEN
    // First send: no threadId (or undefined)
    expect(requestBodies[0]?.threadId).toBeUndefined();
    // Second send: reuses thread_shared
    expect(requestBodies[1]?.threadId).toBe("thread_shared");
  });

  it("posts metadata to the backend after all sends succeed", async () => {
    /**
     * Verifies that sendTrackedEmails posts a CreateEmailRequest to the
     * backend /emails endpoint after all Gmail API sends complete.
     *
     * The backend POST is what creates the DynamoDB records needed to track
     * opens. Skipping this step means the backend has no record of the email
     * and no open events can ever be stored.
     *
     * If this contract is violated, emails are delivered but never tracked —
     * the dashboard shows nothing.
     */
    // GIVEN
    fetchMock.mockImplementation(makeDefaultFetchMock({ id: "m", threadId: "t" }));

    // WHEN
    await sendTrackedEmails({
      token: "tok",
      recipients: ["a@example.com"],
      subject: "Test subject",
      bodyHtml: "<p>body</p>",
    });

    // THEN
    const backendCall = fetchMock.mock.calls.find((c: unknown[]) =>
      !(c[0] as string).includes("gmail.googleapis.com")
    );
    expect(backendCall).toBeDefined();
    const body = JSON.parse(backendCall![1].body as string) as {
      subject: string;
      recipients: Array<{ email: string; pixel_id: string }>;
    };
    expect(body.subject).toBe("Test subject");
    expect(body.recipients[0].email).toBe("a@example.com");
    expect(body.recipients[0].pixel_id).toBeTruthy();
  });

  it("throws when the backend POST /emails returns a non-ok response", async () => {
    /**
     * Verifies that sendTrackedEmails throws when the backend /emails endpoint
     * returns an HTTP error after the Gmail sends have completed.
     *
     * The backend POST failure means the DynamoDB record was never created, so
     * no opens can be tracked. Silently swallowing the error would leave the
     * user with emails delivered but nothing visible in the dashboard.
     *
     * If this contract is violated, a backend outage goes unnoticed and the
     * tracking dashboard silently drops all open events.
     */
    // GIVEN
    fetchMock.mockImplementation(async (url: string) => {
      if ((url as string).includes("users/me/profile")) {
        return { ok: true, json: async () => ({ emailAddress: "sender@example.com" }) };
      }
      if ((url as string).includes("gmail.googleapis.com")) {
        return { ok: true, json: async () => ({ id: "m", threadId: "t" }) };
      }
      // Backend /emails endpoint returns 500
      return { ok: false, status: 500, json: async () => ({ message: "Internal Server Error" }) };
    });

    // WHEN / THEN
    await expect(
      sendTrackedEmails({
        token: "tok",
        recipients: ["a@example.com"],
        subject: "Hi",
        bodyHtml: "<p>Hello</p>",
      })
    ).rejects.toThrow(/500/);
  });

  it("throws when the gmail API returns a non-ok response", async () => {
    /**
     * Verifies that sendTrackedEmails throws (rather than silently continuing)
     * when the Gmail API returns an HTTP error.
     *
     * Swallowing a send failure would mean the user believes the email was
     * delivered when it was not — a serious UX regression.
     *
     * If this contract is violated, failed sends go unnoticed and recipients
     * never receive the email.
     */
    // GIVEN
    fetchMock.mockImplementation(async (url: string) => {
      if ((url as string).includes("users/me/profile")) {
        return { ok: true, json: async () => ({ emailAddress: "sender@example.com" }) };
      }
      return { ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) };
    });

    // WHEN / THEN
    await expect(
      sendTrackedEmails({
        token: "bad_tok",
        recipients: ["a@example.com"],
        subject: "Hi",
        bodyHtml: "<p>Hello</p>",
      })
    ).rejects.toThrow();
  });
});
