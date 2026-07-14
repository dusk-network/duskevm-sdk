#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";

const result = spawnSync(
  "deno",
  ["doc", "--quiet", "--unstable-sloppy-imports", "--lint", "src/index.ts"],
  {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  }
);

const output = stripVTControlCharacters(`${result.stdout ?? ""}${result.stderr ?? ""}`);

if (result.error) throw result.error;

if (result.status === 0) {
  process.stdout.write(output);
  console.log("Verified public API documentation");
  process.exit(0);
}

const diagnostics = [...output.matchAll(/^error\[([^\]]+)\]: ([^\n]+)$/gm)];
// Deno currently treats imported types as private even when the package entrypoint
// re-exports them. Keep the exception exact so every other documentation error fails.
const allowedImportedTypes = new Set([
  "Abi",
  "Chain",
  "EIP1193Provider",
  "Hex",
  "PublicClient",
  "Transport",
]);

const unexpected = diagnostics.filter(([, code, message]) => {
  if (code !== "private-type-ref") return true;
  const match = message.match(/references private type '([^']+)'$/);
  return !match || !allowedImportedTypes.has(match[1]);
});

if (diagnostics.length === 0 || unexpected.length > 0) {
  process.stderr.write(output);
  process.exit(result.status ?? 1);
}

console.log(
  `Verified public API documentation (${diagnostics.length} known imported-type references accepted)`
);
