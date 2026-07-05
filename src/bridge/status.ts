import { pollOperationStatus } from "../status/index.js";
import type { BridgeOperationStatus } from "../status/index.js";
import type { DuskL1SubmittedTransaction } from "../l1/index.js";
import type { JsonValue } from "../types.js";
import type {
  PreparedBridgeOperation,
  WaitForBridgeOperationStatusOptions,
} from "./types.js";

export type BridgeTrackingMetadata = Record<string, JsonValue> & {
  operationId: string;
  direction: PreparedBridgeOperation["direction"];
  assetKind: PreparedBridgeOperation["asset"]["kind"];
  l1TransactionHash?: string;
  l1BlockHeight?: string;
  l2TransactionHash?: string;
  l2BlockNumber?: string;
};

export function bridgeOperationTrackingMetadata(
  operation: PreparedBridgeOperation,
  metadata: Record<string, JsonValue> = {}
): BridgeTrackingMetadata {
  return {
    ...metadata,
    operationId: operation.id,
    direction: operation.direction,
    assetKind: operation.asset.kind,
  };
}

export function submittedBridgeOperationStatus(
  operation: PreparedBridgeOperation,
  submittedTransaction: DuskL1SubmittedTransaction
): BridgeOperationStatus<BridgeTrackingMetadata> {
  return {
    phase: "submitted",
    updatedAt: Date.now(),
    metadata: bridgeOperationTrackingMetadata(operation, {
      ...operation.metadata,
      l1TransactionHash: submittedTransaction.transactionHash,
    }),
  };
}

export async function waitForBridgeOperationStatus<TMetadata extends Record<string, JsonValue>>(
  operation: PreparedBridgeOperation,
  observe: (
    operation: PreparedBridgeOperation
  ) => Promise<BridgeOperationStatus<TMetadata>> | BridgeOperationStatus<TMetadata>,
  options: WaitForBridgeOperationStatusOptions = {}
): Promise<BridgeOperationStatus<TMetadata>> {
  return pollOperationStatus({
    observe: async () => observe(operation),
    ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}
