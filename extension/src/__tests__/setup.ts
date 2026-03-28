/**
 * Global test setup for the extension test suite.
 *
 * Runs before any test module is imported (via vitest setupFiles), so the
 * chrome global is in place when background.ts is first evaluated. A stub
 * placed inside a test body arrives too late because static imports resolve
 * before any test-body code runs.
 *
 * This is the single authoritative chrome stub for the entire suite.
 * Individual tests configure specific mock behaviour via:
 *   vi.mocked(chrome.identity.getAuthToken).mockImplementation(...)
 *   vi.mocked(chrome.runtime.sendMessage).mockImplementation(...)
 * and reset it in beforeEach(() => vi.resetAllMocks()).
 */

import { vi } from "vitest";

vi.stubGlobal("chrome", {
  runtime: {
    id: "test-extension-id",
    onMessage: {
      addListener: vi.fn(),
    },
    sendMessage: vi.fn(),
  },
  identity: {
    getAuthToken: vi.fn(),
  },
});
