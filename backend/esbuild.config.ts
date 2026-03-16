import { build } from "esbuild";
import { writeFileSync } from "node:fs";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/index.js",
  // aws-sdk v3 is available in the Lambda runtime; externalizing saves bundle size
  external: ["@aws-sdk/*"],
  sourcemap: true,
  minify: false,
});

// Lambda nodejs20.x treats .js files as CJS unless a package.json with
// "type":"module" exists in the same directory as the bundle. Write that
// marker so the ESM bundle is loaded correctly at cold start.
writeFileSync("dist/package.json", JSON.stringify({ type: "module" }));

console.log("Build complete: dist/index.js");
