/**
 * A 1x1 transparent PNG image as a Buffer constant.
 *
 * This is the minimal valid PNG: signature + IHDR (1x1, 8-bit RGBA) +
 * IDAT (single transparent pixel) + IEND.
 *
 * Used as the response body for GET /emailTrack/{pixelId} so the email
 * client renders nothing visible while the Lambda records the open event.
 */
export const PIXEL_PNG: Buffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ" +
    "AABjkB6QAAAABJRU5ErkJggg==",
  "base64"
);
