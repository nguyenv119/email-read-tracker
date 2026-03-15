import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the esbuild post-build step that writes dist/package.json
 * with {"type":"module"} to enable Lambda nodejs20.x ESM loading.
 */

// REVIEW: mocking core dependency — test may not reflect real behavior
const mockBuild = vi.fn();
vi.mock("esbuild", () => ({
  build: mockBuild,
}));

const mockWriteFileSync = vi.fn();
vi.mock("node:fs", () => ({
  default: { writeFileSync: mockWriteFileSync },
  writeFileSync: mockWriteFileSync,
}));

describe("esbuild post-build ESM package.json marker", () => {
  beforeEach(() => {
    mockBuild.mockReset();
    mockWriteFileSync.mockReset();
    vi.resetModules();
    mockBuild.mockResolvedValue({});
  });

  it("writes dist/package.json with type:module after a successful build", async () => {
    /**
     * Verifies that the build script writes a package.json containing
     * {"type":"module"} into the dist/ directory after esbuild completes.
     *
     * This matters because Lambda nodejs20.x treats .js files as CommonJS by
     * default. Without a dist/package.json declaring "type":"module", the
     * Lambda runtime fails to load the ESM bundle at cold start with an error
     * like "require() is not defined in ES module scope".
     *
     * If this contract breaks, every Lambda invocation fails immediately on
     * cold start and all tracking pixel requests return 5xx errors.
     */
    // Re-mock so mockBuild is fresh for this import
    mockBuild.mockResolvedValue({});

    await import("../../esbuild.config.js");

    expect(mockWriteFileSync).toHaveBeenCalledOnce();

    const [filePath, content] = mockWriteFileSync.mock.calls[0] as [string, string];
    expect(filePath).toBe("dist/package.json");

    const parsed = JSON.parse(content);
    expect(parsed.type).toBe("module");
  });

  it("does not write dist/package.json before esbuild build completes", async () => {
    /**
     * Verifies that writeFileSync is only called after the esbuild promise
     * resolves, not before.
     *
     * This matters because writing package.json before the build completes
     * could leave an inconsistent dist/ directory — the marker file exists but
     * the bundle does not, causing Lambda to attempt ESM loading of a missing
     * file.
     *
     * If this contract breaks, a build error would still leave dist/package.json
     * behind, and a subsequent partial deploy might serve an ESM marker without
     * a valid bundle.
     */
    let resolveBuild!: () => void;
    mockBuild.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveBuild = resolve;
      })
    );

    vi.resetModules();
    const importPromise = import("../../esbuild.config.js");

    // writeFileSync must NOT have been called while the build is still pending
    expect(mockWriteFileSync).not.toHaveBeenCalled();

    resolveBuild();
    await importPromise;

    // After resolution, it must have been called
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });
});
