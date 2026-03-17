/**
 * Global test setup for the extension test suite.
 *
 * Runs before any test module is imported (via vitest setupFiles), so the
 * chrome global is in place when background.ts is first evaluated. A stub
 * placed inside a test body arrives too late because static imports resolve
 * before any test-body code runs.
 */

import { vi } from "vitest";

const getAuthTokenMock = vi.fn();

vi.stubGlobal("chrome", {
  runtime: {
    onMessage: {
      addListener: vi.fn(),
    },
  },
  identity: {
    getAuthToken: getAuthTokenMock,
  },
});
