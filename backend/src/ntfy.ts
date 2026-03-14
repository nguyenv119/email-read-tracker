/**
 * Sends a real-time open notification to ntfy.sh.
 *
 * The topic is read from the NTFY_TOPIC environment variable at call time so
 * the module can be imported before env vars are available (e.g., in tests
 * that set env vars after import).
 */
export async function notifyOpen(
  pixelId: string,
  recipient: string
): Promise<void> {
  const topic = process.env["NTFY_TOPIC"];
  if (!topic) {
    throw new Error(
      "Missing required environment variable: NTFY_TOPIC must be set"
    );
  }

  const message = `Email opened by ${recipient} (pixel: ${pixelId})`;

  const response = await fetch(
    `https://ntfy.sh/${encodeURIComponent(topic)}`,
    {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: message,
    }
  );

  if (!response.ok) {
    throw new Error(
      `ntfy.sh notification failed: HTTP ${response.status}`
    );
  }
}
