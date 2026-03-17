/**
 * capture-compose.ts
 *
 * Attaches to a running Chrome instance via CDP, opens a Gmail compose window,
 * and captures the real outerHTML as a test fixture.
 *
 * ## How to run
 *
 * Step 1 — Quit Chrome completely, then relaunch it with remote debugging:
 *
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *     --remote-debugging-port=9222 \
 *     --user-data-dir="$HOME/Library/Application Support/Google/Chrome"
 *
 *   (Using your real profile means you're already logged into Gmail.)
 *
 * Step 2 — Open https://mail.google.com in that Chrome window and wait for
 *   the inbox to load.
 *
 * Step 3 — Run this script:
 *
 *   cd extension
 *   npm run capture-fixture
 *
 * ## Output
 *
 *   extension/src/__tests__/fixtures/gmail-compose.html
 *
 * Commit this file so CI and other developers don't need a browser.
 * Re-run whenever Gmail's DOM changes and compose tests start failing.
 */

import { chromium } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE_OUT_PATH = path.resolve(
  __dirname,
  "../src/__tests__/fixtures/gmail-compose.html"
);

const CDP_URL = "http://localhost:9222";

async function main(): Promise<void> {
  console.log(`Connecting to Chrome at ${CDP_URL}...`);
  console.log(
    "Make sure Chrome is running with --remote-debugging-port=9222 and Gmail is open."
  );

  // Connect to the already-running Chrome — no new browser launched,
  // no automation flags, no login required.
  const browser = await chromium.connectOverCDP(CDP_URL);

  // Find the Gmail tab (or use the first available context/page)
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error("No browser contexts found. Is Gmail open in Chrome?");
  }

  let page = contexts[0].pages().find((p) =>
    p.url().includes("mail.google.com")
  );

  if (!page) {
    console.log("Gmail tab not found — opening one now...");
    page = await contexts[0].newPage();
    await page.goto("https://mail.google.com", { waitUntil: "networkidle" });
  }

  console.log("Found Gmail tab:", page.url());

  // Wait for inbox to be ready
  await page.waitForSelector('[gh="cm"], [aria-label="Compose"]', {
    timeout: 30_000,
  });

  // ── Open Compose ────────────────────────────────────────────────────────────
  console.log("Clicking Compose...");
  const composeButton = page
    .locator('[gh="cm"], [aria-label="Compose"]')
    .first();
  await composeButton.click();

  // Wait for the compose window (role=dialog containing a contenteditable body)
  const composeWindow = page.locator('[role="dialog"]').filter({
    has: page.locator('[contenteditable="true"]'),
  });
  await composeWindow.waitFor({ timeout: 15_000 });
  console.log("Compose window detected.");

  // ── Capture HTML ────────────────────────────────────────────────────────────
  const html = await composeWindow.first().evaluate((el) => el.outerHTML);

  // ── Write fixture ───────────────────────────────────────────────────────────
  const fixtureDir = path.dirname(FIXTURE_OUT_PATH);
  if (!fs.existsSync(fixtureDir)) {
    fs.mkdirSync(fixtureDir, { recursive: true });
  }

  fs.writeFileSync(FIXTURE_OUT_PATH, html, "utf8");
  console.log(`\nFixture saved → ${FIXTURE_OUT_PATH}`);
  console.log(`File size: ${(html.length / 1024).toFixed(1)} KB`);

  // Disconnect without closing — don't kill the user's browser
  await browser.close();
  console.log("Done. Commit the fixture file to lock in the real Gmail DOM.");
}

main().catch((err) => {
  console.error("\ncapture-compose failed:", err);
  console.error(
    "\nTroubleshooting:\n" +
      "  1. Is Chrome running with --remote-debugging-port=9222?\n" +
      "  2. Is Gmail open in that Chrome window?\n" +
      "  3. Try visiting http://localhost:9222 in another browser to confirm CDP is active."
  );
  process.exit(1);
});
