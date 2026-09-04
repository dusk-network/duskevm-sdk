import type { Hex } from "viem";
import {
  duskContractIdToEvmAddress,
  observeDepositStatus,
  parseMessagePassedLog,
  resolveDuskTransactionHash,
  type DepositReceiptClient,
  type DepositTrackingMetadata,
  type DuskTransactionProjectionClient,
  type EvmReceiptLike,
  type ParsedWithdrawalMessage,
} from "../bridge/index.js";
import { DUSK_CONTRACT_CALL_TARGET } from "../envelope/index.js";
import { sdkError } from "../errors.js";
import { normalizeEvmAddress } from "../evm-address.js";
import {
  L2_CROSS_DOMAIN_MESSENGER_ADDRESS,
  prepareDuskContractCall,
  type DuskEvmPreparedCall,
  type PrepareDuskContractCallOptions,
  type PreparedDuskContractCall,
} from "../l2/index.js";
import type { SubmittedDuskEvmContractCall } from "../l1/index.js";
import { pollOperationStatus, type BridgeOperationStatus } from "../status/index.js";
import type { EvmAddress, JsonValue, TransactionHash } from "../types.js";
import {
  hashDuskCrossDomainMessage,
  hashDuskEvmCrossDomainMessage,
  parseCrossDomainMessageFromWithdrawal,
  parseSentMessageReceipt,
  type CrossDomainMessage,
} from "./message.js";

/** Public-client capabilities used to validate and confirm an L2 submission. */
export type DuskContractCallPublicClient = {
  getChainId(): Promise<number>;
  getBytecode(parameters: { address: EvmAddress }): Promise<Hex | undefined>;
  waitForTransactionReceipt(parameters: { hash: Hex }): Promise<EvmReceiptLike & {
    status?: "success" | "reverted" | Hex;
  }>;
};

/** Caller-supplied transaction function, normally backed by a viem wallet client. */
export type DuskEvmTransactionSender = (
  transaction: DuskEvmPreparedCall
) => Promise<TransactionHash>;

/** Options for submitting and optionally confirming an L2-to-Dusk call. */
export type SubmitDuskContractCallOptions = PrepareDuskContractCallOptions & {
  publicClient: DuskContractCallPublicClient;
  sendTransaction: DuskEvmTransactionSender;
  expectedChainId: number;
} &
  (
    | { wait?: false; l1MessengerAddress?: EvmAddress }
    | { wait: true; l1MessengerAddress: EvmAddress }
  );

/** Result of an L2-to-Dusk application call submission. */
export type SubmittedDuskContractCall = {
  prepared: PreparedDuskContractCall;
  transactionHash: Hex;
  receipt?: EvmReceiptLike;
  withdrawal?: ParsedWithdrawalMessage;
  crossDomainMessage?: CrossDomainMessage;
  messageHash?: Hex;
};

/** Correlation metadata spanning the native Dusk and projected Ethereum identities. */
export type DuskEvmContractCallTrackingMetadata = Omit<
  DepositTrackingMetadata,
  "l1TransactionHash"
> & {
  duskTransactionHash: Hex;
  l1TransactionHash?: Hex;
  messageHash?: Hex;
  target: EvmAddress;
  payload: Hex;
  minGasLimit: number;
};

/** Validate the chain and canonical Messenger predeploy for a deployment. */
export async function validateDuskEvmDeployment(params: {
  client: Pick<DuskContractCallPublicClient, "getChainId" | "getBytecode">;
  expectedChainId: number;
  messengerAddress?: EvmAddress;
}): Promise<{ chainId: number; messengerAddress: EvmAddress }> {
  if (!Number.isSafeInteger(params.expectedChainId) || params.expectedChainId <= 0) {
    throw sdkError("INVALID_OPERATION", "Expected DuskEVM chain id must be a positive integer");
  }
  const messengerAddress = params.messengerAddress ?? L2_CROSS_DOMAIN_MESSENGER_ADDRESS;
  const chainId = await params.client.getChainId();
  if (chainId !== params.expectedChainId) {
    throw sdkError(
      "CLIENT_ERROR",
      `DuskEVM chain mismatch: expected ${params.expectedChainId}, received ${chainId}`
    );
  }
  const code = await params.client.getBytecode({ address: messengerAddress });
  if (!code || code === "0x") {
    throw sdkError(
      "CLIENT_ERROR",
      `No L2CrossDomainMessenger code exists at ${messengerAddress} on chain ${chainId}`
    );
  }
  return { chainId, messengerAddress };
}

/** Prepare, validate, and submit a generic zero-value L2-to-Dusk call. */
export async function submitDuskContractCall(
  options: SubmitDuskContractCallOptions
): Promise<SubmittedDuskContractCall> {
  const prepared = prepareDuskContractCall(options);
  await validateDuskEvmDeployment({
    client: options.publicClient,
    expectedChainId: options.expectedChainId,
    messengerAddress: prepared.l2Transaction.to,
  });
  const transactionHash = normalizeTransactionHash(
    await options.sendTransaction(prepared.l2Transaction)
  );
  const result: SubmittedDuskContractCall = { prepared, transactionHash };
  if (!options.wait) return result;
  if (!options.l1MessengerAddress) {
    throw sdkError(
      "INVALID_OPERATION",
      "L1 cross-domain Messenger address is required when waiting for confirmation"
    );
  }

  const receipt = await options.publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status === "reverted" || receipt.status === "0x0") {
    throw sdkError("TRANSACTION_FAILED", "DuskEVM contract-call transaction reverted", receipt);
  }
  if (
    receipt.transactionHash &&
    normalizeTransactionHash(receipt.transactionHash) !== transactionHash
  ) {
    throw sdkError(
      "CLIENT_ERROR",
      "DuskEVM client returned a receipt for a different transaction",
      receipt
    );
  }
  const { withdrawal, crossDomainMessage } = findPreparedDuskContractCall(
    receipt,
    prepared,
    transactionHash,
    options.l1MessengerAddress
  );
  return {
    ...result,
    receipt,
    withdrawal,
    crossDomainMessage,
    messageHash: hashDuskCrossDomainMessage(crossDomainMessage),
  };
}

function findPreparedDuskContractCall(
  receipt: EvmReceiptLike,
  prepared: PreparedDuskContractCall,
  transactionHash: Hex,
  l1MessengerAddress: EvmAddress
): { withdrawal: ParsedWithdrawalMessage; crossDomainMessage: CrossDomainMessage } {
  const expectedL2Messenger = normalizeAddress(prepared.l2Transaction.to);
  const expectedL1Messenger = normalizeAddress(l1MessengerAddress);
  const expectedTarget = normalizeAddress(DUSK_CONTRACT_CALL_TARGET);
  let match:
    | { withdrawal: ParsedWithdrawalMessage; crossDomainMessage: CrossDomainMessage }
    | undefined;

  for (const log of receipt.logs ?? []) {
    const correlatedLog = { ...log };
    const blockNumber = log.blockNumber ?? receipt.blockNumber;
    if (blockNumber !== undefined) correlatedLog.blockNumber = blockNumber;
    const observedTransactionHash = log.transactionHash ?? receipt.transactionHash;
    if (observedTransactionHash !== undefined) {
      correlatedLog.transactionHash = observedTransactionHash;
    }
    const parsed = parseMessagePassedLog(correlatedLog);
    if (!parsed) continue;
    if (
      parsed.transactionHash &&
      normalizeTransactionHash(parsed.transactionHash) !== transactionHash
    ) {
      continue;
    }
    if (normalizeAddress(parsed.withdrawal.sender) !== expectedL2Messenger) continue;
    if (parsed.withdrawal.value !== 0n) continue;
    if (normalizeAddress(parsed.withdrawal.target) !== expectedL1Messenger) {
      continue;
    }

    let message: CrossDomainMessage;
    try {
      message = parseCrossDomainMessageFromWithdrawal(parsed.withdrawal);
    } catch {
      continue;
    }
    if (
      normalizeAddress(message.target) !== expectedTarget ||
      message.message.toLowerCase() !== prepared.envelopeHex.toLowerCase() ||
      message.value !== 0n ||
      message.minGasLimit !== BigInt(prepared.minGasLimit)
    ) {
      continue;
    }
    if (match) {
      throw sdkError(
        "INVALID_OPERATION",
        "Receipt contains more than one MessagePassed event matching the prepared Dusk call"
      );
    }
    match = { withdrawal: parsed, crossDomainMessage: message };
  }

  if (!match) {
    throw sdkError(
      "INVALID_OPERATION",
      "Receipt does not contain a MessagePassed event matching the prepared Dusk call"
    );
  }
  return match;
}

/** Observe a Dusk-to-DuskEVM Messenger call using standard OP deposit tracking. */
export async function observeDuskEvmContractCallStatus(params: {
  l1Client: DepositReceiptClient & DuskTransactionProjectionClient;
  l2Client: DepositReceiptClient & Pick<DuskContractCallPublicClient, "getChainId" | "getBytecode">;
  submitted: SubmittedDuskEvmContractCall;
  expectedChainId: number;
  metadata?: Record<string, JsonValue>;
  now?: () => number;
}): Promise<BridgeOperationStatus<DuskEvmContractCallTrackingMetadata>> {
  await validateDuskEvmDeployment({
    client: params.l2Client,
    expectedChainId: params.expectedChainId,
  });
  const duskTransactionHash = normalizeTransactionHash(
    params.submitted.submission.submitted.transactionHash
  );
  const target = normalizeEvmAddress(params.submitted.target, "DuskEVM contract-call target");
  const payload = normalizePayload(params.submitted.payload);
  const minGasLimit = params.submitted.minGasLimit;
  const intentMetadata = {
    ...(params.metadata ?? {}),
    xdmDirection: "dusk-to-duskevm" as const,
    duskTransactionHash,
    target,
    payload,
    minGasLimit,
  };
  const l1TransactionHash = await resolveDuskTransactionHash(
    params.l1Client,
    duskTransactionHash
  );
  if (l1TransactionHash === null) {
    return {
      phase: "submitted",
      updatedAt: (params.now ?? Date.now)(),
      metadata: {
        ...intentMetadata,
        stage: "l1_pending",
      },
    };
  }
  const normalizedL1TransactionHash = normalizeTransactionHash(l1TransactionHash);
  const l1Receipt = await receiptOrUndefined(params.l1Client, normalizedL1TransactionHash);
  if (!l1Receipt) {
    return {
      phase: "submitted",
      updatedAt: (params.now ?? Date.now)(),
      metadata: {
        ...intentMetadata,
        l1TransactionHash: normalizedL1TransactionHash,
        stage: "l1_pending",
      },
    };
  }
  if (l1Receipt.status === "reverted") {
    const status = await observeDepositStatus({
      l1Client: params.l1Client,
      l2Client: params.l2Client,
      l1TransactionHash: normalizedL1TransactionHash,
      metadata: intentMetadata,
      ...(params.now === undefined ? {} : { now: params.now }),
    });
    return { ...status, metadata: { ...intentMetadata, ...status.metadata } };
  }
  const messengerAddress = duskContractIdToEvmAddress(
    normalizeContractId(params.submitted.messengerContractId)
  );
  const message = parseSentMessageReceipt(l1Receipt, messengerAddress);
  if (
    normalizeEvmAddress(message.target, "cross-domain target") !== target ||
    message.message.toLowerCase() !== payload.toLowerCase() ||
    message.minGasLimit !== BigInt(minGasLimit) ||
    message.value !== 0n
  ) {
    throw sdkError(
      "CLIENT_ERROR",
      "Projected Dusk receipt does not match the submitted cross-domain intent",
      message
    );
  }
  const messageHash = hashDuskEvmCrossDomainMessage(message);
  const status = await observeDepositStatus({
    l1Client: params.l1Client,
    l2Client: params.l2Client,
    l1TransactionHash: normalizedL1TransactionHash,
    expectedRelay: {
      messengerAddress: L2_CROSS_DOMAIN_MESSENGER_ADDRESS,
      messageHash,
    },
    metadata: {
      ...intentMetadata,
      messageHash,
    },
    ...(params.now === undefined ? {} : { now: params.now }),
  });
  return {
    ...status,
    metadata: { ...intentMetadata, ...status.metadata, messageHash },
  };
}

async function receiptOrUndefined(
  client: DepositReceiptClient,
  hash: Hex
): Promise<Awaited<ReturnType<DepositReceiptClient["getTransactionReceipt"]>> | undefined> {
  try {
    return await client.getTransactionReceipt({ hash });
  } catch (error) {
    if (isReceiptNotFound(error)) return undefined;
    throw error;
  }
}

function isReceiptNotFound(error: unknown): boolean {
  let current = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    if (
      current instanceof Error &&
      (current.name === "TransactionReceiptNotFoundError" ||
        current.name === "TransactionNotFoundError")
    ) {
      return true;
    }
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

function normalizeContractId(value: string): Hex {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/u.test(normalized)) {
    throw sdkError("CLIENT_ERROR", "L1 cross-domain Messenger contract id must be 32 bytes");
  }
  return normalized.toLowerCase() as Hex;
}

function normalizePayload(value: Hex): Hex {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) {
    throw sdkError("CLIENT_ERROR", "DuskEVM contract-call payload must be byte hex");
  }
  return value.toLowerCase() as Hex;
}

/** Poll a Dusk-to-DuskEVM Messenger call until relay success, failure, or timeout. */
export async function waitForDuskEvmContractCallStatus(params: Parameters<
  typeof observeDuskEvmContractCallStatus
>[0] & {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<BridgeOperationStatus<DuskEvmContractCallTrackingMetadata>> {
  await validateDuskEvmDeployment({
    client: params.l2Client,
    expectedChainId: params.expectedChainId,
  });
  return pollOperationStatus({
    observe: () => observeDuskEvmContractCallStatus(params),
    ...(params.intervalMs === undefined ? {} : { intervalMs: params.intervalMs }),
    ...(params.timeoutMs === undefined ? {} : { timeoutMs: params.timeoutMs }),
    ...(params.signal === undefined ? {} : { signal: params.signal }),
  });
}

function normalizeTransactionHash(value: TransactionHash): Hex {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/u.test(normalized)) {
    throw sdkError("CLIENT_ERROR", "DuskEVM wallet returned an invalid transaction hash", value);
  }
  return normalized.toLowerCase() as Hex;
}

function normalizeAddress(value: EvmAddress): string {
  return normalizeEvmAddress(value, "cross-domain address").toLowerCase();
}
