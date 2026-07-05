import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: [
    "src/index.ts",
    "src/bridge/index.ts",
    "src/envelope/index.ts",
    "src/l1/index.ts",
    "src/l2/index.ts",
    "src/status/index.ts",
  ],
  format: ["esm"],
  minify: false,
  sourcemap: true,
  splitting: false,
  target: "es2023",
  treeshake: true,
});
