#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  normalizeL1TransactionHash,
  normalizeL1Receipt,
  parseCommandArgv,
  runJsonCommandArgv,
} from "./local-smoke-command.mjs";
import {
  buildFinalizeWithdrawalTransaction,
  buildProveWithdrawalTransaction,
  createBridgeClient,
  defineDuskEvmChain,
  parseDuskToLux,
  parseMessagePassedReceipt,
  parseNativeCreditWithdrawal,
  prepareDrc20Withdrawal,
  prepareDrc721Withdrawal,
  prepareNativeWithdrawal,
  submitDuskL1Transaction,
  withdrawalLifecycleStatus,
} from "../dist/index.js";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const jsonOutput = args.has("--json");
const DRY_RUN_ADDRESS = "0x1111111111111111111111111111111111111111";
const DRY_RUN_CONTRACT_ID = `0x${"11".repeat(32)}`;

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

const env = process.env;
const l2Rpc = env.SDK_SMOKE_L2_RPC ?? "http://localhost:9545";
const l2ChainId = parseInteger(env.SDK_SMOKE_L2_CHAIN_ID ?? "745", "SDK_SMOKE_L2_CHAIN_ID");
const l2ChainName = env.SDK_SMOKE_L2_CHAIN_NAME ?? "DuskEVM Local";
const l2PrivateKey = env.SDK_SMOKE_L2_PRIVATE_KEY;
const l2Recipient = resolveL2Recipient(env, l2PrivateKey, dryRun);
const l1Recipient = env.SDK_SMOKE_L1_RECIPIENT ?? l2Recipient;
const nativeDepositLux = env.SDK_SMOKE_NATIVE_DEPOSIT_LUX ?? "1";
const nativeWithdrawWei = parseBigint(
  env.SDK_SMOKE_NATIVE_WITHDRAW_WEI ?? "1000000000",
  "SDK_SMOKE_NATIVE_WITHDRAW_WEI"
);
const minGasLimit = parseInteger(env.SDK_SMOKE_MIN_GAS_LIMIT ?? "200000", "SDK_SMOKE_MIN_GAS_LIMIT");
const l1StandardBridgeContractId = env.SDK_SMOKE_L1_STANDARD_BRIDGE_ID;
const l1Erc721BridgeContractId = env.SDK_SMOKE_L1_ERC721_BRIDGE_ID;
const portalContractId = env.SDK_SMOKE_PORTAL_ID;
const nativeCreditTargetId = env.SDK_SMOKE_NATIVE_CREDIT_TARGET_ID;
const effectiveNativeCreditTargetId = nativeCreditTargetId ?? (dryRun ? DRY_RUN_CONTRACT_ID : undefined);
const nativeCreditPayload = env.SDK_SMOKE_NATIVE_CREDIT_PAYLOAD ?? "0x";

const results = [];

const bridge = createBridgeClient({
  ...(dryRun
    ? {}
    : {
        l1: commandL1Client(),
      }),
  contracts: {
    ...(l1StandardBridgeContractId || dryRun
      ? { l1StandardBridgeContractId: l1StandardBridgeContractId ?? "dry-run-standard-bridge" }
      : {}),
    ...(l1Erc721BridgeContractId || dryRun
      ? { l1Erc721BridgeContractId: l1Erc721BridgeContractId ?? "dry-run-erc721-bridge" }
      : {}),
  },
  gas: {
    defaultMinGasLimit: minGasLimit,
  },
});

await runNativeDeposit();
await runNativeWithdrawal();
await runOptionalTokenWithdrawals();

if (jsonOutput) {
  console.log(JSON.stringify({ dryRun, results }, bigintJson, 2));
} else {
  for (const result of results) {
    console.log(`${result.name}: ${result.status}`);
    if (result.detail) console.log(`  ${result.detail}`);
  }
}

async function runNativeDeposit() {
  if (!dryRun) requireEnv("SDK_SMOKE_L1_STANDARD_BRIDGE_ID", l1StandardBridgeContractId);

  const operation = bridge.prepareNativeDeposit({
    amountLux: parseDuskToLux(nativeDepositLux),
    l2Recipient,
    minGasLimit,
  });
  const request = await bridge.buildL1Transaction(operation);
  results.push({
    name: "native deposit request",
    status: "prepared",
    detail: `${request.contractId ?? "<missing-contract>"}::${request.method ?? "<missing-method>"}`,
  });

  if (dryRun) return;
  const submitted = await bridge.submitNativeDeposit({
    amountLux: parseDuskToLux(nativeDepositLux),
    l2Recipient,
    minGasLimit,
  });
  results.push({
    name: "native deposit submit",
    status: "submitted",
    detail: submitted.submittedTransaction.transactionHash,
  });
}

async function runNativeWithdrawal() {
  if (!effectiveNativeCreditTargetId && !env.SDK_SMOKE_WITHDRAW_EXTRA_DATA) {
    throw new Error(
      "SDK_SMOKE_WITHDRAW_EXTRA_DATA or SDK_SMOKE_NATIVE_CREDIT_TARGET_ID is required"
    );
  }
  const operation = effectiveNativeCreditTargetId
    ? bridge.prepareNativeContractCreditWithdrawal({
        targetContractId: effectiveNativeCreditTargetId,
        amountWei: nativeWithdrawWei,
        minGasLimit,
        payload: nativeCreditPayload,
      })
    : prepareNativeWithdrawal({
        recipient: l1Recipient,
        amountWei: nativeWithdrawWei,
        minGasLimit,
        extraData: env.SDK_SMOKE_WITHDRAW_EXTRA_DATA ?? "0x",
      });
  results.push({
    name: "native withdrawal L2 call",
    status: "prepared",
    detail: `${operation.l2Transaction.to} value=${operation.l2Transaction.value ?? 0n}`,
  });

  if (dryRun) return;
  requireEnv("SDK_SMOKE_L2_PRIVATE_KEY", l2PrivateKey);

  const receipt = await sendL2Call(operation.l2Transaction);
  const message = parseMessagePassedReceipt(receipt);
  const expectedCredit = effectiveNativeCreditTargetId
    ? parseNativeCreditWithdrawal(message.withdrawal, {
        ...(env.SDK_SMOKE_L1_MESSENGER_EVM
          ? { l1CrossDomainMessenger: env.SDK_SMOKE_L1_MESSENGER_EVM }
          : {}),
        ...(env.SDK_SMOKE_L1_STANDARD_BRIDGE_EVM
          ? { l1StandardBridge: env.SDK_SMOKE_L1_STANDARD_BRIDGE_EVM }
          : {}),
      })
    : undefined;
  results.push({
    name: "native withdrawal message",
    status: "observed",
    detail: message.withdrawalHash,
  });
  if (expectedCredit) {
    results.push({
      name: "native contract credit",
      status: "derived",
      detail: expectedCredit.creditId,
    });
  }

  const proofPath = env.SDK_SMOKE_WITHDRAWAL_PROOF_JSON;
  if (!proofPath) {
    const status = withdrawalLifecycleStatus({
      operation,
      message,
    });
    results.push({
      name: "native withdrawal proof",
      status: status.metadata.stage,
      detail: status.message ?? "set SDK_SMOKE_WITHDRAWAL_PROOF_JSON to submit prove/finalize",
    });
    return;
  }
  requireEnv("SDK_SMOKE_PORTAL_ID", portalContractId);

  const proof = await readJson(proofPath);
  const l1 = commandL1Client();
  const prove = await submitDuskL1Transaction(
    l1,
    buildProveWithdrawalTransaction({
      portalContractId,
      withdrawal: message.withdrawal,
      disputeGameIndex: proof.disputeGameIndex,
      outputRootProof: proof.outputRootProof,
      withdrawalProof: proof.withdrawalProof,
      ...(env.SDK_SMOKE_PROVE_GAS_LIMIT
        ? { gasLimit: BigInt(env.SDK_SMOKE_PROVE_GAS_LIMIT) }
        : {}),
    }),
    { wait: env.SDK_SMOKE_L1_WAIT === "1" }
  );
  results.push({
    name: "native withdrawal prove",
    status: "submitted",
    detail: prove.submitted.transactionHash,
  });

  const finalize = await submitDuskL1Transaction(
    l1,
    buildFinalizeWithdrawalTransaction({
      portalContractId,
      withdrawal: message.withdrawal,
      ...(env.SDK_SMOKE_FINALIZE_GAS_LIMIT
        ? { gasLimit: BigInt(env.SDK_SMOKE_FINALIZE_GAS_LIMIT) }
        : {}),
    }),
    { wait: env.SDK_SMOKE_L1_WAIT === "1" }
  );
  results.push({
    name: "native withdrawal finalize",
    status: "submitted",
    detail: finalize.submitted.transactionHash,
  });

  if (expectedCredit && env.SDK_SMOKE_NATIVE_CREDIT_CLAIM === "1") {
    if (env.SDK_SMOKE_L1_WAIT !== "1") {
      throw new Error("SDK_SMOKE_L1_WAIT=1 is required before claiming a finalized native credit");
    }
    const pending = await bridge.readNativeCredit(expectedCredit.creditId);
    if (pending.state !== "pending") {
      throw new Error(`expected pending native credit, observed ${pending.state}`);
    }
    const claim = await bridge.submitNativeCreditClaim(
      { creditId: expectedCredit.creditId, payload: expectedCredit.payload },
      { wait: true }
    );
    const claimed = await bridge.readNativeCredit(expectedCredit.creditId);
    if (claimed.state !== "claimed" || claimed.amountLux !== pending.amountLux) {
      throw new Error(`native credit claim did not reach claimed state: ${claimed.state}`);
    }
    results.push({
      name: "native contract credit claim",
      status: "claimed",
      detail: `${claim.submitted.transactionHash} amount=${claimed.amountLux} LUX`,
    });
  }
}

async function runOptionalTokenWithdrawals() {
  const drc20 = maybeDrc20Withdrawal();
  if (drc20) {
    results.push({
      name: "DRC20 withdrawal L2 call",
      status: "prepared",
      detail: `${drc20.l2Transaction.to} amount=${drc20.asset.amount}`,
    });
    if (!dryRun && env.SDK_SMOKE_SEND_TOKEN_WITHDRAWALS === "1") {
      requireEnv("SDK_SMOKE_L2_PRIVATE_KEY", l2PrivateKey);
      const receipt = await sendL2Call(drc20.l2Transaction);
      results.push({
        name: "DRC20 withdrawal tx",
        status: "submitted",
        detail: receipt.transactionHash,
      });
    }
  }

  const drc721 = maybeDrc721Withdrawal();
  if (drc721) {
    results.push({
      name: "DRC721 withdrawal L2 call",
      status: "prepared",
      detail: `${drc721.l2Transaction.to} tokenId=${drc721.asset.tokenId}`,
    });
    if (!dryRun && env.SDK_SMOKE_SEND_TOKEN_WITHDRAWALS === "1") {
      requireEnv("SDK_SMOKE_L2_PRIVATE_KEY", l2PrivateKey);
      const receipt = await sendL2Call(drc721.l2Transaction);
      results.push({
        name: "DRC721 withdrawal tx",
        status: "submitted",
        detail: receipt.transactionHash,
      });
    }
  }
}

function maybeDrc20Withdrawal() {
  if (!env.SDK_SMOKE_DRC20_L2_TOKEN) return undefined;
  return prepareDrc20Withdrawal({
    ...(env.SDK_SMOKE_DRC20_L1_TOKEN ? { l1Token: env.SDK_SMOKE_DRC20_L1_TOKEN } : {}),
    l2Token: env.SDK_SMOKE_DRC20_L2_TOKEN,
    amount: BigInt(env.SDK_SMOKE_DRC20_AMOUNT ?? "1"),
    recipient: l1Recipient,
    minGasLimit,
    extraData: env.SDK_SMOKE_WITHDRAW_EXTRA_DATA ?? "0x",
  });
}

function maybeDrc721Withdrawal() {
  if (!env.SDK_SMOKE_DRC721_L1_TOKEN || !env.SDK_SMOKE_DRC721_L2_TOKEN) return undefined;
  return prepareDrc721Withdrawal({
    l1Token: env.SDK_SMOKE_DRC721_L1_TOKEN,
    l2Token: env.SDK_SMOKE_DRC721_L2_TOKEN,
    tokenId: env.SDK_SMOKE_DRC721_TOKEN_ID ?? "1",
    recipient: l1Recipient,
    minGasLimit,
    extraData: env.SDK_SMOKE_WITHDRAW_EXTRA_DATA ?? "0x",
  });
}

async function sendL2Call(call) {
  const account = privateKeyToAccount(l2PrivateKey);
  const chain = defineDuskEvmChain({
    id: l2ChainId,
    name: l2ChainName,
    rpcUrl: l2Rpc,
  });
  const transport = http(l2Rpc);
  const walletClient = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });
  const hash = await walletClient.sendTransaction({
    account,
    chain,
    to: call.to,
    data: call.data,
    ...(call.value === undefined ? {} : { value: call.value }),
  });
  return publicClient.waitForTransactionReceipt({
    hash,
    timeout: parseInteger(env.SDK_SMOKE_L2_RECEIPT_TIMEOUT_MS ?? "120000", "SDK_SMOKE_L2_RECEIPT_TIMEOUT_MS"),
  });
}

function commandL1Client() {
  const submitArgv = parseCommandArgv(env, "SDK_SMOKE_L1_SUBMIT_ARGV", {
    optional: true,
  });
  if (!submitArgv && !dryRun) {
    throw new Error("SDK_SMOKE_L1_SUBMIT_ARGV is required outside --dry-run");
  }
  const readArgv = parseCommandArgv(env, "SDK_SMOKE_L1_READ_ARGV", {
    optional: true,
  });
  return {
    async submitTransaction(request) {
      if (!submitArgv) {
        throw new Error("SDK_SMOKE_L1_SUBMIT_ARGV is required outside --dry-run");
      }
      const raw = await runJsonCommandArgv(submitArgv, request, {
        jsonReplacer: bigintJson,
      });
      const transactionHash = normalizeL1TransactionHash(raw);
      return { transactionHash, raw };
    },
    async getGasPriceLux() {
      const gasPriceArgv = parseCommandArgv(env, "SDK_SMOKE_L1_GAS_PRICE_ARGV", {
        optional: true,
      });
      if (!gasPriceArgv) return undefined;
      const raw = await runJsonCommandArgv(gasPriceArgv, {});
      if (typeof raw === "number" && Number.isSafeInteger(raw)) return BigInt(raw);
      if (typeof raw === "string" && /^\d+$/.test(raw)) return BigInt(raw);
      if (raw && typeof raw === "object") {
        const value = raw.gasPrice ?? raw.price ?? raw.lux;
        if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
        if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
      }
      throw new Error("SDK_SMOKE_L1_GAS_PRICE_ARGV did not return a usable gas price");
    },
    async waitForTransaction(transactionHash, options) {
      const waitArgv = parseCommandArgv(env, "SDK_SMOKE_L1_WAIT_ARGV", {
        optional: true,
      });
      if (!waitArgv) {
        throw new Error("SDK_SMOKE_L1_WAIT_ARGV is required when SDK_SMOKE_L1_WAIT=1");
      }
      const raw = await runJsonCommandArgv(waitArgv, { transactionHash, options });
      return normalizeL1Receipt(raw);
    },
    ...(readArgv
      ? {
          async readContract(request) {
            return runJsonCommandArgv(readArgv, request, { jsonReplacer: bigintJson });
          },
        }
      : {}),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function accountAddressFromPrivateKey(privateKey) {
  return privateKeyToAccount(privateKey).address;
}

function resolveL2Recipient(env, l2PrivateKey, dryRun) {
  if (env.SDK_SMOKE_L2_RECIPIENT) return env.SDK_SMOKE_L2_RECIPIENT;
  if (l2PrivateKey) return accountAddressFromPrivateKey(l2PrivateKey);
  if (dryRun) return DRY_RUN_ADDRESS;
  throw new Error("SDK_SMOKE_L2_RECIPIENT is required in real mode when SDK_SMOKE_L2_PRIVATE_KEY is unset");
}

function parseInteger(value, name) {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an unsigned integer`);
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${name} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(parsed);
}

function parseBigint(value, name) {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an unsigned integer`);
  return BigInt(value);
}

function requireEnv(name, value) {
  if (!value) throw new Error(`${name} is required`);
}

function bigintJson(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function printHelp() {
  console.log(`Usage: npm run smoke:local -- [--dry-run] [--json]

Runs an optional local DuskEVM SDK bridge smoke against an already-running local
Rusk/DuskEVM setup. The script never runs in CI unless explicitly invoked.

Required for real mode:
  SDK_SMOKE_L1_SUBMIT_ARGV            JSON argv that reads a DuskL1TransactionRequest JSON from stdin.
                                      BigInt request fields arrive as decimal strings.
  SDK_SMOKE_L1_STANDARD_BRIDGE_ID     L1 standard bridge contract id.
  SDK_SMOKE_L2_PRIVATE_KEY            EVM private key funded on L2.

Common optional settings:
  SDK_SMOKE_L2_RPC                    Default: http://localhost:9545
  SDK_SMOKE_L2_CHAIN_ID               Default: 745
  SDK_SMOKE_L2_CHAIN_NAME             Default: DuskEVM Local
  SDK_SMOKE_L2_RECIPIENT              Deposit recipient. Defaults to L2 private key address; required if key unset.
  SDK_SMOKE_L2_RECEIPT_TIMEOUT_MS     Default: 120000
  SDK_SMOKE_L1_RECIPIENT              Withdrawal recipient. Defaults to SDK_SMOKE_L2_RECIPIENT.
  SDK_SMOKE_L1_GAS_PRICE_ARGV         Optional JSON argv gas-price adapter.
  SDK_SMOKE_L1_WAIT=1                 Enables L1 receipt waiting.
  SDK_SMOKE_L1_READ_ARGV              JSON argv used for authoritative contract reads.
  SDK_SMOKE_NATIVE_DEPOSIT_LUX        Default: 1
  SDK_SMOKE_NATIVE_WITHDRAW_WEI       Default: 1000000000
  SDK_SMOKE_NATIVE_CREDIT_TARGET_ID   Full Dusk ContractId for a native contract-credit withdrawal.
  SDK_SMOKE_NATIVE_CREDIT_PAYLOAD     Callback payload. Default: 0x
  SDK_SMOKE_NATIVE_CREDIT_CLAIM=1     Read, claim, and verify a finalized native contract credit.
  SDK_SMOKE_L1_MESSENGER_EVM          Optional expected L1 Messenger address while parsing.
  SDK_SMOKE_L1_STANDARD_BRIDGE_EVM    Optional expected L1 Standard Bridge address while parsing.
  SDK_SMOKE_MIN_GAS_LIMIT             Default: 200000
  SDK_SMOKE_WITHDRAW_EXTRA_DATA       Default: 0x
  SDK_SMOKE_L1_WAIT_ARGV              JSON argv used when SDK_SMOKE_L1_WAIT=1.
  SDK_SMOKE_WITHDRAWAL_PROOF_JSON     Enables prove/finalize submission.
  SDK_SMOKE_PORTAL_ID                 Required when proof JSON is set.
  SDK_SMOKE_PROVE_GAS_LIMIT           Optional prove request gas limit override.
  SDK_SMOKE_FINALIZE_GAS_LIMIT        Optional finalize request gas limit override.
  SDK_SMOKE_L1_ERC721_BRIDGE_ID       Optional L1 ERC721 bridge contract id.
  SDK_SMOKE_DRC20_L2_TOKEN            Prepares DRC20 withdrawal call.
  SDK_SMOKE_DRC20_L1_TOKEN            Optional DRC20 L1 token metadata.
  SDK_SMOKE_DRC20_AMOUNT              Default: 1
  SDK_SMOKE_DRC721_L1_TOKEN           With SDK_SMOKE_DRC721_L2_TOKEN prepares DRC721 withdrawal call.
  SDK_SMOKE_DRC721_L2_TOKEN           With SDK_SMOKE_DRC721_L1_TOKEN prepares DRC721 withdrawal call.
  SDK_SMOKE_DRC721_TOKEN_ID           Default: 1
  SDK_SMOKE_SEND_TOKEN_WITHDRAWALS=1  Submit token withdrawals instead of only preparing them.
`);
}
