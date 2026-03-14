import { build } from "esbuild";

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

console.log("Build complete: dist/index.js");
