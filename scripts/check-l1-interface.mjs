#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const sourceUrl = new URL("../src/l1/dusk-contract-interface.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");

const requiredExports = [
  "duskL1ContractInterfaceSource",
  "duskL1WireFormats",
  "duskL1ContractMethods",
];
const requiredMethods = [
  "depositETHToWithValue",
  "bridgeERC20To",
  "claimNativeCredit",
  "nativeCredit",
  "bridgeERC721To",
  "proveWithdrawalTransaction",
  "finalizeWithdrawalTransaction",
  "finalizeWithdrawalTransactionExternalProof",
  "checkWithdrawal",
  "profileFinalizeWithdrawalTransaction",
];
const forbiddenFragments = [
  "companionArtifacts",
  "sourcePath",
  "wasmFile",
  "error_snapshot",
  "event_fixtures",
  "abi_snapshot",
  "contracts/dispute-game-factory",
];

for (const name of requiredExports) {
  requireFragment(`export const ${name}`, `missing export ${name}`);
}
for (const name of requiredMethods) {
  requireFragment(`\"${name}\"`, `missing allowlisted method ${name}`);
}
for (const fragment of forbiddenFragments) {
  if (source.includes(fragment)) {
    throw new Error(`Public L1 interface contains forbidden private metadata: ${fragment}`);
  }
}

if (Buffer.byteLength(source) > 16_384) {
  throw new Error("Public L1 interface exceeded its 16 KiB disclosure budget");
}

console.log("Public L1 interface is restricted to the allowlisted SDK projection");

function requireFragment(fragment, message) {
  if (!source.includes(fragment)) throw new Error(message);
}
