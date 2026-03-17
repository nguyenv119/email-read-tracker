/**
 * capture-compose.ts
 *
 * Playwright script that authenticates with Gmail, opens a compose window,
 * and captures the real outerHTML of the compose root element to a fixture
 * file for use in compose.test.ts.
 *
 * ## One-time setup (human must run once)
 *
 *   cd extension
 *   npm run capture-fixture
 *
 * First run: A Chrome window opens to Gmail login — sign in manually.
 * The session is saved to playwright/.auth.json for subsequent runs.
 * Subsequent runs: the saved session is reused automatically.
 *
 * Re-run whenever Gmail's DOM changes and compose tests start failing.
 *
 * ## Output
 *
 *   extension/src/__tests__/fixtures/gmail-compose.html
 *
 * Commit this file so CI and other developers don't need a browser to run
 * compose tests.
 */

import { chromium } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AUTH_STATE_PATH = path.resolve(__dirname, ".auth.json");
const FIXTURE_OUT_PATH = path.resolve(
  __dirname,
  "../src/__tests__/fixtures/gmail-compose.html"
);

async function main(): Promise<void> {
  const hasAuth = fs.existsSync(AUTH_STATE_PATH);

  // ── Launch Chrome ─────────────────────────────────────────────────────────
  // headless: false is required so the user can log in on the first run, and
  // so that Gmail renders the full compose DOM (headless can behave differently).
  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
  });

  const context = hasAuth
    ? await browser.newContext({ storageState: AUTH_STATE_PATH })
    : await browser.newContext();

  const page = await context.newPage();

  // ── Authenticate ──────────────────────────────────────────────────────────
  if (!hasAuth) {
    console.log("No saved session found. Opening Gmail login...");
    console.log(
      "Sign in with your Google account, then wait for Gmail inbox to load."
    );
    console.log("The script will continue automatically once you are logged in.");

    await page.goto("https://mail.google.com", { waitUntil: "networkidle" });

    // Wait until we land on the Gmail inbox (URL changes from accounts.google.com)
    await page.waitForURL(/mail\.google\.com/, { timeout: 120_000 });

    // Wait for the Compose button to appear — confirms inbox is fully loaded
    await page.waitForSelector('[gh="cm"]', { timeout: 60_000 });

    // Save session for future runs
    await context.storageState({ path: AUTH_STATE_PATH });
    console.log(`Session saved to ${AUTH_STATE_PATH}`);
  } else {
    console.log("Reusing saved session from", AUTH_STATE_PATH);
    await page.goto("https://mail.google.com", { waitUntil: "networkidle" });

    // Confirm inbox loaded
    await page.waitForSelector('[gh="cm"]', { timeout: 60_000 });
  }

  // ── Open Compose ──────────────────────────────────────────────────────────
  console.log("Clicking Compose...");

  // Gmail's compose button has aria-label="Compose" or the gh="cm" attribute.
  // Try both selectors for robustness.
  const composeButton = page.locator('[gh="cm"], [aria-label="Compose"]').first();
  await composeButton.click();

  // Wait for the compose window to appear.
  // The compose window root is a <div> with role="dialog" inside the compose
  // overlay. We wait for the contenteditable body to be ready.
  const composeWindow = page.locator('[role="dialog"]').filter({
    has: page.locator('[contenteditable="true"]'),
  });
  await composeWindow.waitFor({ timeout: 15_000 });
  console.log("Compose window detected.");

  // ── Capture HTML ──────────────────────────────────────────────────────────
  // Grab the outerHTML of the compose window root so we have the full tree
  // including the toolbar, To/Subject/Body fields, and Send button.
  const html = await composeWindow.first().evaluate((el) => el.outerHTML);

  // ── Write fixture ─────────────────────────────────────────────────────────
  const fixtureDir = path.dirname(FIXTURE_OUT_PATH);
  if (!fs.existsSync(fixtureDir)) {
    fs.mkdirSync(fixtureDir, { recursive: true });
  }

  fs.writeFileSync(FIXTURE_OUT_PATH, html, "utf8");
  console.log(`Fixture saved to ${FIXTURE_OUT_PATH}`);
  console.log(`File size: ${(html.length / 1024).toFixed(1)} KB`);

  await browser.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error("capture-compose failed:", err);
  process.exit(1);
});
