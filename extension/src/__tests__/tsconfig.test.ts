import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsconfigPath = resolve(__dirname, "../../tsconfig.json");
const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8")) as {
  compilerOptions?: {
    moduleResolution?: string;
    module?: string;
    composite?: boolean;
  };
  references?: Array<{ path: string }>;
};

describe("extension/tsconfig.json", () => {
  it("declares a project reference to shared", () => {
    /**
     * Verifies that extension/tsconfig.json contains a references entry
     * pointing to the shared package.
     *
     * TypeScript composite project references enforce that shared is built
     * before extension. Without this reference, tsc --build silently
     * skips the shared package, meaning extension code may consume stale
     * or missing type declarations.
     *
     * If this contract is violated, incremental builds may use outdated
     * shared types without any error, causing subtle type mismatches that
     * only surface at runtime.
     */
    expect(tsconfig.references).toBeDefined();
    const paths = (tsconfig.references ?? []).map((r) => r.path);
    expect(paths).toContain("../shared");
  });

  it("uses NodeNext moduleResolution for project reference compatibility", () => {
    /**
     * Verifies that moduleResolution is "NodeNext" (not "Bundler").
     *
     * TypeScript project references require all referenced packages to use
     * compatible module resolution modes. The shared package uses "NodeNext";
     * if extension uses "Bundler", tsc rejects the project reference chain
     * with a hard error, breaking all composite builds.
     *
     * If this contract is violated, running `tsc --noEmit` from the root
     * fails with TS6306, blocking type-checking in CI and local development.
     */
    expect(tsconfig.compilerOptions?.moduleResolution).toBe("NodeNext");
  });

  it("uses NodeNext module to match moduleResolution", () => {
    /**
     * Verifies that module is "NodeNext" to match moduleResolution.
     *
     * TypeScript requires module and moduleResolution to be consistent.
     * "NodeNext" moduleResolution must be paired with "NodeNext" module;
     * mismatching them produces a TS5096 error.
     *
     * If this contract is violated, the tsconfig is invalid and no
     * type-checking can run against the extension source.
     */
    expect(tsconfig.compilerOptions?.module).toBe("NodeNext");
  });
});
