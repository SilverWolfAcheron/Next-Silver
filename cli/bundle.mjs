import { build } from "esbuild";

await build({
  entryPoints: ["cli/main.ts"],
  outfile: "dist-cli/silver.mjs",
  platform: "node",
  format: "esm",
  target: "node22",
  bundle: true,
  logLevel: "info",
});
