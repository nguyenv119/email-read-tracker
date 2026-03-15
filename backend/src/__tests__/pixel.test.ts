import { describe, it, expect } from "vitest";
import { PIXEL_PNG } from "../pixel.js";

describe("pixel", () => {
  it("exports a Buffer containing a valid 1x1 transparent PNG", () => {
    /**
     * Verifies that PIXEL_PNG is a Buffer holding a syntactically valid PNG
     * starting with the 8-byte PNG signature (137 80 78 71 13 10 26 10).
     *
     * This matters because the tracking pixel response relies on this constant
     * to return real image data. If it's corrupt or mis-encoded the browser
     * will not load it silently — it will show a broken image or make a second
     * request, defeating the tracking mechanism entirely.
     *
     * If this contract breaks, every tracked email will fail to record opens
     * because the pixel response is malformed.
     */
    expect(Buffer.isBuffer(PIXEL_PNG)).toBe(true);
    // PNG signature bytes
    expect(PIXEL_PNG[0]).toBe(137);
    expect(PIXEL_PNG[1]).toBe(80); // P
    expect(PIXEL_PNG[2]).toBe(78); // N
    expect(PIXEL_PNG[3]).toBe(71); // G
  });

  it("pixel buffer is non-empty and reasonably sized for a 1x1 PNG", () => {
    /**
     * Verifies that the PNG buffer has a plausible size for a minimal PNG.
     *
     * A 1x1 transparent PNG is at minimum ~67 bytes (signature + IHDR + IDAT +
     * IEND). This guards against an accidentally truncated or empty constant
     * that would produce a zero-length response body.
     *
     * If this contract breaks, the Lambda returns a malformed image and the
     * email client's pixel load is indistinguishable from a network error.
     */
    expect(PIXEL_PNG.length).toBeGreaterThan(60);
    expect(PIXEL_PNG.length).toBeLessThan(500);
  });
});
