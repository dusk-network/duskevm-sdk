#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { decodeFunctionData, parseAbi } from "viem";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "dusk-evm-sdk-package-"));

try {
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8")
  );
  const jsrJson = JSON.parse(await readFile(path.join(repositoryRoot, "jsr.json"), "utf8"));

  if (packageJson.name !== "@dusk/evm-sdk" || jsrJson.name !== packageJson.name) {
    throw new Error("npm and JSR package names must both be @dusk/evm-sdk");
  }
  if (packageJson.version !== jsrJson.version) {
    throw new Error("npm and JSR package versions must match");
  }
  if (!packageJson.version.includes("-beta.")) {
    throw new Error("Release candidate must remain on a beta version");
  }
  if (packageJson.publishConfig?.tag !== "beta") {
    throw new Error("Prereleases must default to the npm beta dist-tag");
  }

  run("npm", ["run", "build"], repositoryRoot);
  const sdk = await import("../dist/index.js");
  const contractId = `0x${"ab".repeat(32)}`;
  const recipient = sdk.duskContractIdToEvmAddress(contractId);
  const extraData = sdk.encodeDuskNativeContractCredit(contractId, "0x1234");
  const prepareNative = (amount, extra = extraData, gas = "150000") => JSON.parse(execFileSync(process.execPath, [
    "scripts/local-xdm-smoke.mjs", "prepare-native-withdrawal",
    "--recipient", recipient, "--amount-wei", amount,
    "--min-gas-limit", gas, "--extra-data", extra,
  ], { cwd: repositoryRoot, encoding: "utf8", stdio: "pipe" }));
  // Exercise the actual subprocess contract, including re-preparation after a balance clamp.
  for (const [amount, gas] of [["2000000000", "150000"], ["1000000000", "150000"], ["0", "0"]]) {
    const prepared = prepareNative(amount, extraData, gas);
    assert.equal(prepared.to.toLowerCase(), "0x4200000000000000000000000000000000000010");
    assert.equal(prepared.value, amount);
    const decoded = decodeFunctionData({
      abi: parseAbi(["function bridgeETHTo(address to, uint32 minGasLimit, bytes extraData) payable"]),
      data: prepared.data,
    });
    assert.equal(decoded.functionName, "bridgeETHTo");
    assert.equal(decoded.args[0].toLowerCase(), recipient);
    assert.deepEqual(decoded.args.slice(1), [Number(gas), extraData]);
  }
  assert.throws(() => prepareNative("1000000000", "0x"));
  assert.throws(() => prepareNative("-1"));
  assert.throws(() => prepareNative("1000000000", extraData, "4294967296"));
  const readDriver = path.join(temporaryRoot, "empty-factory.mjs");
  await writeFile(readDriver, `#!/usr/bin/env node
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const { method } = JSON.parse(input);
    console.log(JSON.stringify(method === "gameCount" ? "0" : "0x" + "ab".repeat(32)));
  `, { mode: 0o700 });
  const selectArgs = ["scripts/local-xdm-smoke.mjs", "select-withdrawal-proof",
    "--l1-read-driver", readDriver, "--rusk-url", "http://127.0.0.1:1",
    "--l2-rpc-url", "http://127.0.0.1:1", "--portal-contract-id", contractId,
    "--withdrawal-hash", `0x${"cd".repeat(32)}`, "--withdrawal-block-number", "1"];
  const emptyFactory = spawnSync(process.execPath, selectArgs, { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(emptyFactory.status, 75, emptyFactory.stderr);
  assert.equal(emptyFactory.stdout, "");
  assert.match(emptyFactory.stderr, /No dispute games/);
  await writeFile(readDriver, "#!/usr/bin/env node\nconsole.log('invalid JSON');\n");
  const brokenReader = spawnSync(process.execPath, selectArgs, { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(brokenReader.status, 1, brokenReader.stderr);
  assert.match(brokenReader.stderr, /invalid JSON/);
  const packOutput = run(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", temporaryRoot],
    repositoryRoot
  );
  const [packed] = JSON.parse(packOutput);
  const files = new Set(packed.files.map(({ path: filePath }) => filePath));

  for (const expected of [
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "dist/index.js",
    "dist/index.d.ts",
    "dist/bridge/index.js",
    "dist/envelope/index.js",
    "dist/l1/index.js",
    "dist/l2/index.js",
    "dist/status/index.js",
    "dist/xdm/index.js",
    "package.json",
  ]) {
    if (!files.has(expected)) throw new Error(`Packed package is missing ${expected}`);
  }

  for (const filePath of files) {
    if (
      filePath.startsWith("src/") ||
      filePath.startsWith("scripts/") ||
      filePath.endsWith(".test.ts") ||
      filePath === "package-lock.json" ||
      filePath === "jsr.json"
    ) {
      throw new Error(`Packed package contains development-only file ${filePath}`);
    }
  }

  const tarball = path.join(temporaryRoot, packed.filename);
  const consumerRoot = path.join(temporaryRoot, "consumer");
  await mkdir(consumerRoot, { recursive: true });
  await writeFile(
    path.join(consumerRoot, "package.json"),
    JSON.stringify({ private: true, type: "module" })
  );
  run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    consumerRoot
  );

  const nodeSmoke = `
    const entrypoints = [
      "@dusk/evm-sdk",
      "@dusk/evm-sdk/bridge",
      "@dusk/evm-sdk/envelope",
      "@dusk/evm-sdk/l1",
      "@dusk/evm-sdk/l2",
      "@dusk/evm-sdk/status",
      "@dusk/evm-sdk/xdm",
    ];
    for (const entrypoint of entrypoints) await import(entrypoint);
    const sdk = await import("@dusk/evm-sdk");
    if (sdk.parseDuskToLux("1.5") !== 1500000000n) throw new Error("amount smoke failed");
    const message = sdk.prepareDuskEvmContractCall({
      messengerContractId: "11".repeat(32),
      target: "0x2222222222222222222222222222222222222222",
      payload: "0x1234",
    });
    if (message.l1Transaction.method !== "sendMessage") throw new Error("XDM method smoke failed");
    if ("amountLux" in message.l1Transaction) throw new Error("XDM value boundary failed");
  `;
  run("node", ["--input-type=module", "--eval", nodeSmoke], consumerRoot);
  run(
    "deno",
    ["eval", "--node-modules-dir=manual", nodeSmoke],
    consumerRoot
  );

  await writeFile(
    path.join(consumerRoot, "index.html"),
    '<main id="app"></main><script type="module" src="/main.js"></script>\n'
  );
  await writeFile(
    path.join(consumerRoot, "main.js"),
    'import { formatLuxToDusk } from "@dusk/evm-sdk";\n' +
      'document.querySelector("#app").textContent = formatLuxToDusk(1500000000n);\n'
  );
  run(
    "node",
    [path.join(repositoryRoot, "node_modules/vite/bin/vite.js"), "build"],
    consumerRoot
  );

  console.log(
    `Verified ${packageJson.name}@${packageJson.version}: ${files.size} files, Node and Deno imports, and Vite browser bundle`
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}
