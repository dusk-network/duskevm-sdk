#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceArgument = process.argv[2];

if (!sourceArgument) {
  throw new Error(
    "Usage: npm run import:l1-interface -- <dusk-l1-public-interface.json>"
  );
}

const sourcePath = path.resolve(process.cwd(), sourceArgument);
const requiredContracts = {
  l1CrossDomainMessenger: {
    artifactName: "l1_cross_domain_messenger",
    methods: {
      sendMessage: signature(
        [
          ["target", "EVMAddress"],
          ["message", "Vec < u8 >"],
          ["min_gas_limit", "u32"],
        ],
        "()"
      ),
    },
  },
  l1StandardBridge: {
    artifactName: "l1_standard_bridge",
    methods: {
      depositETHToWithValue: signature(
        [
          ["to", "EVMAddress"],
          ["amount_lux", "u64"],
          ["min_gas_limit", "u32"],
          ["extra_data", "Vec < u8 >"],
        ],
        "()"
      ),
      bridgeERC20To: signature(
        [
          ["l1_token", "EVMAddress"],
          ["l2_token", "EVMAddress"],
          ["to", "EVMAddress"],
          ["amount", "U256"],
          ["min_gas_limit", "u32"],
          ["extra_data", "Vec < u8 >"],
        ],
        "()"
      ),
      claimNativeCredit: signature(
        [
          ["credit_id", "Bytes32"],
          ["payload", "Vec < u8 >"],
        ],
        "bool"
      ),
      nativeCredit: signature(
        [["credit_id", "Bytes32"]],
        "(Bytes32 , EVMAddress , u64 , Bytes32 , u8)",
        "read"
      ),
    },
  },
  l1Erc721Bridge: {
    artifactName: "l1_erc721_bridge",
    methods: {
      bridgeERC721To: signature(
        [
          ["local_token", "EVMAddress"],
          ["remote_token", "EVMAddress"],
          ["to", "EVMAddress"],
          ["token_id", "U256"],
          ["min_gas_limit", "u32"],
          ["extra_data", "Vec < u8 >"],
        ],
        "()"
      ),
    },
  },
  optimismPortal: {
    artifactName: "optimism_portal",
    methods: {
      proveWithdrawalTransaction: signature(
        [
          ["withdrawal", "WithdrawalTransaction"],
          ["dispute_game_index", "U256"],
          ["output_root_proof", "OutputRootProof"],
          ["withdrawal_proof", "Vec < Vec < u8 > >"],
        ],
        "()"
      ),
      finalizeWithdrawalTransaction: signature(
        [["withdrawal", "WithdrawalTransaction"]],
        "()"
      ),
      finalizeWithdrawalTransactionExternalProof: signature(
        [
          ["withdrawal", "WithdrawalTransaction"],
          ["proof_submitter_addr", "EVMAddress"],
        ],
        "()"
      ),
      checkWithdrawal: signature(
        [
          ["withdrawal_hash", "Bytes32"],
          ["proof_submitter", "EVMAddress"],
        ],
        "()",
        "read"
      ),
      profileFinalizeWithdrawalTransaction: signature(
        [["withdrawal", "WithdrawalTransaction"]],
        "FinalizeWithdrawalGasProfile"
      ),
    },
  },
};

const artifactText = await readFile(sourcePath, "utf8");
const artifact = parseArtifact(artifactText, sourcePath);
const selectedContracts = selectRequiredMethods(artifact);

const output = `// Generated from the public Dusk L1 SDK interface.
// Do not edit manually; run npm run import:l1-interface -- <artifact-path>.

/** Source revision and digest for the imported public Dusk L1 interface. */
export const duskL1ContractInterfaceSource = ${formatJson({
  schemaVersion: artifact.schemaVersion,
  revision: artifact.source.revision,
  interfaceDigestSha256: artifact.source.interfaceDigestSha256,
})} as const;

/** Public bridge recipient wire-format constants owned by the L1 contracts. */
export const duskL1WireFormats = ${formatJson(artifact.wireFormats)} as const;

/** Allowlisted Dusk L1 method signatures used by this SDK. */
export const duskL1ContractMethods = ${formatJson(selectedContracts)} as const;
`;

await writeFile(
  path.join(repositoryRoot, "src/l1/dusk-contract-interface.ts"),
  output
);

function signature(inputs, output, stateMutability = "write") {
  return { stateMutability, inputs, output };
}

function parseArtifact(text, artifactPath) {
  let artifact;
  try {
    artifact = JSON.parse(text);
  } catch (error) {
    throw new Error(`Unable to parse Dusk L1 public interface ${artifactPath}`, {
      cause: error,
    });
  }

  requireExactKeys(
    artifact,
    ["schemaVersion", "source", "contracts", "wireFormats"],
    "public interface"
  );
  if (artifact.schemaVersion !== 1) {
    throw new Error(
      `Unsupported Dusk L1 public interface schema: ${String(artifact.schemaVersion)}`
    );
  }

  requireExactKeys(
    artifact.source,
    ["revision", "interfaceDigestSha256"],
    "source metadata"
  );
  if (!/^[0-9a-f]{40}$/i.test(artifact.source.revision)) {
    throw new Error("Dusk L1 public interface has an invalid source revision");
  }
  if (!/^[0-9a-f]{64}$/i.test(artifact.source.interfaceDigestSha256)) {
    throw new Error("Dusk L1 public interface has an invalid interface digest");
  }

  const expectedContractNames = Object.values(requiredContracts).map(
    ({ artifactName }) => artifactName
  );
  requireExactKeys(artifact.contracts, expectedContractNames, "contracts");
  requireWireFormats(artifact.wireFormats);

  const digestPayload = {
    schemaVersion: artifact.schemaVersion,
    contracts: artifact.contracts,
    wireFormats: artifact.wireFormats,
  };
  const actualDigest = createHash("sha256")
    .update(JSON.stringify(digestPayload))
    .digest("hex");
  if (actualDigest !== artifact.source.interfaceDigestSha256.toLowerCase()) {
    throw new Error(
      `Dusk L1 public interface digest mismatch: expected ${artifact.source.interfaceDigestSha256}, calculated ${actualDigest}`
    );
  }

  return artifact;
}

function requireWireFormats(wireFormats) {
  const formats = {
    bridgeAssetRecipientV1: [
      "tag",
      "version",
      "externalKind",
      "contractKind",
      "rawPublicKeyBytes",
      "contractIdBytes",
    ],
    nativeContractCreditV1: ["tag", "version", "contractIdBytes"],
  };

  requireExactKeys(wireFormats, Object.keys(formats), "wire formats");
  for (const [formatName, fields] of Object.entries(formats)) {
    const format = wireFormats[formatName];
    requireExactKeys(format, fields, `wireFormats.${formatName}`);
    for (const field of fields) {
      if (!Number.isSafeInteger(format[field]) || format[field] < 0) {
        throw new Error(
          `Dusk L1 public interface has invalid wireFormats.${formatName}.${field}`
        );
      }
    }
  }

  const asset = wireFormats.bridgeAssetRecipientV1;
  if (asset.externalKind === asset.contractKind) {
    throw new Error("Dusk L1 asset-recipient kinds must be distinct");
  }
  if (asset.rawPublicKeyBytes === 0 || asset.contractIdBytes === 0) {
    throw new Error("Dusk L1 asset-recipient payload lengths must be positive");
  }
  if (wireFormats.nativeContractCreditV1.contractIdBytes === 0) {
    throw new Error("Dusk L1 native-credit contract id length must be positive");
  }
}

function selectRequiredMethods(artifact) {
  return Object.fromEntries(
    Object.entries(requiredContracts).map(([sdkContractName, requiredContract]) => {
      const contract = artifact.contracts[requiredContract.artifactName];
      requireExactKeys(contract, ["methods"], requiredContract.artifactName);
      if (!Array.isArray(contract.methods)) {
        throw new Error(
          `Dusk L1 public interface has invalid ${requiredContract.artifactName}.methods`
        );
      }

      const requiredMethodNames = Object.keys(requiredContract.methods);
      const actualMethodNames = contract.methods.map((method) => method?.name);
      requireExactValues(
        actualMethodNames,
        requiredMethodNames,
        `${requiredContract.artifactName} methods`
      );

      const methods = Object.fromEntries(
        Object.entries(requiredContract.methods).map(([methodName, expected]) => {
          const method = contract.methods.find((candidate) => candidate.name === methodName);
          requireSignature(requiredContract.artifactName, methodName, method, expected);
          return [methodName, method];
        })
      );
      return [sdkContractName, methods];
    })
  );
}

function requireSignature(contractName, methodName, actual, expected) {
  requireExactKeys(
    actual,
    ["name", "stateMutability", "inputs", "output"],
    `${contractName}.${methodName}`
  );
  if (!Array.isArray(actual.inputs)) {
    throw new Error(`${contractName}.${methodName} has invalid inputs`);
  }
  for (const [index, input] of actual.inputs.entries()) {
    requireExactKeys(input, ["name", "rustType"], `${contractName}.${methodName}.inputs[${index}]`);
  }

  const actualSignature = {
    stateMutability: actual.stateMutability,
    inputs: actual.inputs.map((input) => [input.name, input.rustType]),
    output: actual.output,
  };
  if (JSON.stringify(actualSignature) !== JSON.stringify(expected)) {
    throw new Error(
      `${contractName}.${methodName} changed:\nexpected ${JSON.stringify(expected)}\nactual   ${JSON.stringify(actualSignature)}`
    );
  }
}

function requireExactKeys(value, expectedKeys, description) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Dusk L1 public interface has invalid ${description}`);
  }
  requireExactValues(Object.keys(value), expectedKeys, `${description} fields`);
}

function requireExactValues(actual, expected, description) {
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expected].sort();
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    throw new Error(
      `Unexpected ${description}: expected ${normalizedExpected.join(", ")}; received ${normalizedActual.join(", ")}`
    );
  }
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}
