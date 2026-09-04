#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  defineChain,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  DUSK_CONTRACT_CALL_TARGET,
  buildWithdrawalOutputProof,
  createWithdrawalGameReader,
  findWithdrawalProof,
  l2CrossDomainMessengerAbi,
  prepareDuskEvmContractCall,
  submitDuskContractCall,
  validateDuskEvmDeployment,
  waitForDuskEvmContractCallStatus,
} from "../dist/index.js";

const [mode, ...rawArguments] = process.argv.slice(2);
const options = parseOptions(rawArguments);

if (mode === "send-l2-contract") {
  await sendL2ContractCall(options);
} else if (mode === "build-withdrawal-proof") {
  await buildLiveWithdrawalProof(options);
} else if (mode === "select-withdrawal-proof") {
  await selectLiveWithdrawalProof(options);
} else if (mode === "track-dusk-to-l2") {
  await trackDuskToL2(options);
} else {
  throw new Error(
    "Usage: local-xdm-smoke.mjs <send-l2-contract|build-withdrawal-proof|select-withdrawal-proof|track-dusk-to-l2> --key value ..."
  );
}

async function buildLiveWithdrawalProof(values) {
  const rpcUrl = required(values, "rpc-url");
  const withdrawalHash = bytes32(required(values, "withdrawal-hash"));
  const blockNumber = positiveBigint(required(values, "block-number"), "block-number");
  const client = createPublicClient({ transport: http(rpcUrl) });
  const proof = await buildWithdrawalOutputProof({ client, withdrawalHash, blockNumber });
  printJson({ blockNumber, ...proof });
}

async function selectLiveWithdrawalProof(values) {
  const l2RpcUrl = required(values, "l2-rpc-url");
  const ruskUrl = required(values, "rusk-url");
  const readDriver = required(values, "l1-read-driver");
  const portalContractId = bytes32(required(values, "portal-contract-id")).slice(2);
  const withdrawalHash = bytes32(required(values, "withdrawal-hash"));
  const withdrawalBlockNumber = positiveBigint(
    required(values, "withdrawal-block-number"),
    "withdrawal-block-number"
  );
  const maxGames = positiveBigint(values.get("max-games") ?? "64", "max-games");
  const l2Client = createPublicClient({ transport: http(l2RpcUrl) });
  const reader = {
    readContract(request) {
      return runL1ReadDriver(readDriver, ruskUrl, request);
    },
  };
  const proof = await findWithdrawalProof({
    l2Client,
    gameReader: createWithdrawalGameReader({ reader, portalContractId }),
    withdrawalHash,
    withdrawalBlockNumber,
    maxGames,
  });
  printJson(proof);
}

function runL1ReadDriver(executable, ruskUrl, request) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["sdk-contract-read", "--rusk-url", ruskUrl], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf8").trim();
      if (code !== 0) {
        reject(
          new Error(
            `Dusk contract read driver exited with ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`
          )
        );
        return;
      }
      try {
        resolve(JSON.parse(output));
      } catch (error) {
        reject(new Error(`Dusk contract read driver returned invalid JSON: ${output}`, { cause: error }));
      }
    });
    child.stdin.end(JSON.stringify(request, bigintJson));
  });
}

async function sendL2ContractCall(values) {
  const rpcUrl = required(values, "rpc-url");
  const expectedChainId = positiveInteger(required(values, "chain-id"), "chain-id");
  const applicationContract = address(required(values, "application-contract"));
  const l1MessengerAddress = address(required(values, "l1-messenger-address"));
  const targetContractId = bytes32(required(values, "target-contract-id"));
  const payload = byteHex(required(values, "payload"));
  const privateKey = bytes32(required(values, "private-key"));
  const minGasLimit = positiveInteger(values.get("min-gas-limit") ?? "150000", "min-gas-limit");
  const chain = defineChain({
    id: expectedChainId,
    name: "Local DuskEVM",
    nativeCurrency: { name: "DUSK", symbol: "DUSK", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({ account, chain, transport });

  await validateDuskEvmDeployment({ client: publicClient, expectedChainId });
  const submitted = await submitDuskContractCall({
    publicClient,
    expectedChainId,
    targetContractId,
    payload,
    minGasLimit,
    l1MessengerAddress,
    wait: true,
    sendTransaction: async (transaction) => {
      const decoded = decodeFunctionData({
        abi: l2CrossDomainMessengerAbi,
        data: transaction.data,
      });
      if (decoded.functionName !== "sendMessage") {
        throw new Error("SDK did not prepare a Messenger sendMessage call");
      }
      const [target, envelope, gasLimit] = decoded.args;
      if (target.toLowerCase() !== DUSK_CONTRACT_CALL_TARGET.toLowerCase()) {
        throw new Error("SDK did not target the fixed Dusk contract-call discriminator");
      }
      return walletClient.writeContract({
        address: applicationContract,
        abi: parseAbi(["function sendDuskCall(bytes envelope, uint32 minGasLimit)"]),
        functionName: "sendDuskCall",
        args: [envelope, gasLimit],
        gas: 500_000n,
      });
    },
  });
  const { transactionHash, receipt, withdrawal, crossDomainMessage: message } = submitted;
  if (!receipt || !withdrawal || !message || !submitted.messageHash) {
    throw new Error("SDK did not return confirmed cross-domain identities");
  }
  if (message.sender.toLowerCase() !== applicationContract.toLowerCase()) {
    throw new Error("Cross-domain sender is not the application contract");
  }
  if (message.target.toLowerCase() !== DUSK_CONTRACT_CALL_TARGET.toLowerCase()) {
    throw new Error("Cross-domain target is not the fixed Dusk contract-call discriminator");
  }
  if (message.message.toLowerCase() !== submitted.prepared.envelopeHex.toLowerCase()) {
    throw new Error("Cross-domain payload differs from the SDK envelope");
  }

  printJson({
    transactionHash,
    blockNumber: receipt.blockNumber,
    withdrawalHash: withdrawal.withdrawalHash,
    messageHash: submitted.messageHash,
    envelope: submitted.prepared.envelopeHex,
  });
}

async function trackDuskToL2(values) {
  const l1RpcUrl = required(values, "l1-rpc-url");
  const l2RpcUrl = required(values, "l2-rpc-url");
  const duskTransactionHash = bytes32(required(values, "dusk-transaction-hash"));
  const messengerContractId = bytes32(required(values, "messenger-contract-id"));
  const target = address(required(values, "target"));
  const payload = byteHex(required(values, "payload"));
  const minGasLimit = positiveInteger(required(values, "min-gas-limit"), "min-gas-limit");
  const expectedChainId = positiveInteger(required(values, "chain-id"), "chain-id");
  const timeoutMs = positiveInteger(values.get("timeout-ms") ?? "180000", "timeout-ms");
  const chain = defineChain({
    id: expectedChainId,
    name: "Local DuskEVM",
    nativeCurrency: { name: "DUSK", symbol: "DUSK", decimals: 18 },
    rpcUrls: { default: { http: [l2RpcUrl] } },
  });
  const l1Client = createPublicClient({ transport: http(l1RpcUrl) });
  const l2Client = createPublicClient({ chain, transport: http(l2RpcUrl) });
  const prepared = prepareDuskEvmContractCall({
    messengerContractId,
    target,
    payload,
    minGasLimit,
  });
  const status = await waitForDuskEvmContractCallStatus({
    l1Client,
    l2Client,
    submitted: {
      ...prepared,
      submission: {
        submitted: { transactionHash: duskTransactionHash },
        request: prepared.l1Transaction,
      },
    },
    expectedChainId,
    intervalMs: 1_000,
    timeoutMs,
  });
  if (status.phase !== "finalized" || status.metadata?.stage !== "completed") {
    throw new Error(`Dusk-to-DuskEVM delivery did not complete: ${JSON.stringify(status)}`);
  }
  printJson(status);
}

function parseOptions(arguments_) {
  const parsed = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid option near ${key ?? "end of arguments"}`);
    }
    parsed.set(key.slice(2), value);
  }
  return parsed;
}

function required(values, key) {
  const value = values.get(key);
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be positive`);
  return number;
}

function positiveBigint(value, label) {
  const number = BigInt(value);
  if (number <= 0n) throw new Error(`${label} must be positive`);
  return number;
}

function address(value) {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value)) throw new Error("invalid EVM address");
  return value;
}

function bytes32(value) {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/u.test(normalized)) throw new Error("invalid 32-byte hex value");
  return normalized;
}

function byteHex(value) {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) throw new Error("invalid byte hex value");
  return value;
}

function printJson(value) {
  process.stdout.write(
    `${JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item))}\n`
  );
}

function bigintJson(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}
