import { keccak256, toBytes } from "viem";
import { getL2TransactionHashes } from "viem/op-stack";
import { sdkError } from "../errors.js";
import {
  pollOperationStatus,
  type BridgeOperationStatus,
} from "../status/index.js";
import type { EvmAddress, Hex, JsonValue } from "../types.js";

/** Canonical wallet-facing stages for a Dusk L1 to DuskEVM deposit. */
export type DepositLifecycleStage =
  "l1_pending" | "l2_pending" | "completed" | "failed";

/** Layer on which a bridge deposit has conclusively failed. */
export type DepositFailureLayer = "l1" | "l2";

/** Minimal Ethereum-shaped log required to derive an OP deposit transaction. */
export type DepositReceiptLog = {
  address: EvmAddress;
  blockHash: Hex;
  blockNumber: bigint;
  data: Hex;
  logIndex: number;
  removed: boolean;
  topics: readonly Hex[];
  transactionHash: Hex;
  transactionIndex: number;
};

/** Minimal receipt shape consumed from the Dusk adapter and DuskEVM RPC. */
export type DepositTransactionReceipt = {
  blockNumber: bigint;
  logs: readonly DepositReceiptLog[];
  status: "success" | "reverted";
  transactionHash: Hex;
};

/** Receipt lookup surface implemented by a viem public client. */
export type DepositReceiptClient = {
  getTransactionReceipt(parameters: {
    hash: Hex;
  }): Promise<DepositTransactionReceipt>;
};

/** Persistable metadata returned while observing a bridge deposit. */
export type DepositTrackingMetadata = Record<string, JsonValue> & {
  stage: DepositLifecycleStage;
  l1TransactionHash: Hex;
  l1BlockHeight?: string;
  l2TransactionHash?: Hex;
  l2TransactionHashes?: Hex[];
  l2BlockNumber?: string;
  failureLayer?: DepositFailureLayer;
};

type DepositTrackingMetadataWithoutStage = Record<string, JsonValue> & {
  l1TransactionHash: Hex;
  l1BlockHeight?: string;
  l2TransactionHash?: Hex;
  l2TransactionHashes?: Hex[];
  l2BlockNumber?: string;
  failureLayer?: DepositFailureLayer;
};

/** Inputs required to observe one submitted bridge deposit. */
export type ObserveDepositStatusOptions = {
  l1Client: DepositReceiptClient;
  l2Client: DepositReceiptClient;
  l1TransactionHash: string;
  metadata?: Record<string, JsonValue>;
  now?: () => number;
};

/** Polling controls for waiting on a submitted bridge deposit. */
export type WaitForDepositStatusOptions = ObserveDepositStatusOptions & {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

const RELAYED_MESSAGE_TOPIC = keccak256(toBytes("RelayedMessage(bytes32)"));
const FAILED_RELAYED_MESSAGE_TOPIC = keccak256(
  toBytes("FailedRelayedMessage(bytes32)"),
);

/**
 * Observe a Dusk L1 bridge transaction and its deterministically derived OP
 * deposit transaction without treating temporary receipt absence as failure.
 */
export async function observeDepositStatus(
  options: ObserveDepositStatusOptions,
): Promise<BridgeOperationStatus<DepositTrackingMetadata>> {
  const now = options.now ?? Date.now;
  const l1TransactionHash = normalizeTransactionHash(
    options.l1TransactionHash,
    "Dusk L1 transaction hash",
  );
  const base = {
    ...(options.metadata ?? {}),
    l1TransactionHash,
  };
  const l1Receipt = await receiptOrUndefined(
    options.l1Client,
    l1TransactionHash,
  );

  if (!l1Receipt) {
    return depositStatus("submitted", "l1_pending", now(), base);
  }

  const l1Metadata = {
    ...base,
    l1BlockHeight: l1Receipt.blockNumber.toString(),
  };

  if (l1Receipt.status === "reverted") {
    return depositStatus(
      "failed",
      "failed",
      now(),
      { ...l1Metadata, failureLayer: "l1" },
      "The Dusk L1 bridge transaction failed",
    );
  }

  const l2TransactionHashes = deriveL2TransactionHashes(l1Receipt);
  const l2Metadata = {
    ...l1Metadata,
    l2TransactionHash: l2TransactionHashes[0]!,
    l2TransactionHashes,
  };
  const l2Receipts = await Promise.all(
    l2TransactionHashes.map((hash) =>
      receiptOrUndefined(options.l2Client, hash),
    ),
  );

  if (l2Receipts.some((receipt) => receipt === undefined)) {
    return depositStatus("accepted", "l2_pending", now(), l2Metadata);
  }

  const receipts = l2Receipts as DepositTransactionReceipt[];
  const failedReceipt = receipts.find(
    (receipt) =>
      receipt.status === "reverted" ||
      receiptHasTopic(receipt, FAILED_RELAYED_MESSAGE_TOPIC),
  );

  if (failedReceipt) {
    return depositStatus(
      "failed",
      "failed",
      now(),
      {
        ...l2Metadata,
        failureLayer: "l2",
        l2BlockNumber: failedReceipt.blockNumber.toString(),
      },
      receiptHasTopic(failedReceipt, FAILED_RELAYED_MESSAGE_TOPIC)
        ? "The DuskEVM cross-domain relay failed"
        : "The DuskEVM deposit transaction reverted",
    );
  }

  const unrecognizedReceipt = receipts.find(
    (receipt) => !receiptHasTopic(receipt, RELAYED_MESSAGE_TOPIC),
  );

  if (unrecognizedReceipt) {
    throw sdkError(
      "CLIENT_ERROR",
      "DuskEVM deposit receipt did not confirm cross-domain delivery",
      unrecognizedReceipt,
    );
  }

  return depositStatus("finalized", "completed", now(), {
    ...l2Metadata,
    l2BlockNumber: receipts.at(-1)!.blockNumber.toString(),
  });
}

/** Wait until a bridge deposit completes, fails, or reaches the polling timeout. */
export async function waitForDepositStatus(
  options: WaitForDepositStatusOptions,
): Promise<BridgeOperationStatus<DepositTrackingMetadata>> {
  return pollOperationStatus({
    observe: () => observeDepositStatus(options),
    ...(options.intervalMs === undefined
      ? {}
      : { intervalMs: options.intervalMs }),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

function deriveL2TransactionHashes(receipt: DepositTransactionReceipt): Hex[] {
  const hashes = getL2TransactionHashes({
    logs: receipt.logs as Parameters<typeof getL2TransactionHashes>[0]["logs"],
  });

  if (hashes.length === 0) {
    throw sdkError(
      "CLIENT_ERROR",
      "Dusk L1 receipt did not contain a TransactionDeposited event",
      receipt,
    );
  }

  return hashes;
}

async function receiptOrUndefined(
  client: DepositReceiptClient,
  hash: Hex,
): Promise<DepositTransactionReceipt | undefined> {
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

function receiptHasTopic(
  receipt: DepositTransactionReceipt,
  topic: Hex,
): boolean {
  const normalizedTopic = topic.toLowerCase();
  return receipt.logs.some(
    (log) => log.topics[0]?.toLowerCase() === normalizedTopic,
  );
}

function normalizeTransactionHash(value: string, label: string): Hex {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;

  if (!/^0x[0-9a-fA-F]{64}$/u.test(normalized)) {
    throw sdkError(
      "INVALID_OPERATION",
      `${label} must be a 32-byte hexadecimal hash`,
    );
  }

  return normalized.toLowerCase() as Hex;
}

function depositStatus(
  phase: BridgeOperationStatus["phase"],
  stage: DepositLifecycleStage,
  updatedAt: number,
  metadata: DepositTrackingMetadataWithoutStage,
  message?: string,
): BridgeOperationStatus<DepositTrackingMetadata> {
  return {
    phase,
    updatedAt,
    metadata: { ...metadata, stage },
    ...(message === undefined ? {} : { message }),
  };
}
