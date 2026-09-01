import { toHex, type Hex } from "viem";
import { sdkError } from "../errors.js";
import {
  duskL1ContractMethods,
  type DuskL1ContractReader,
  type DuskL1TransactionReceipt,
} from "../l1/index.js";
import type { BridgeOperationStatus } from "../status/index.js";
import type { JsonValue, TransactionHash } from "../types.js";
import {
  withdrawalLifecycleStatus,
  type ParsedWithdrawalMessage,
  type WithdrawalProofData,
} from "../bridge/index.js";
import type { PreparedDuskContractCall } from "../l2/index.js";
import type { CrossDomainDeliveryState } from "./message.js";

const portalMethods = duskL1ContractMethods.optimismPortal;

/** Authoritative OptimismPortal observation for one proof submitter. */
export type WithdrawalPortalState =
  | { state: "unproven"; finalized: false; finalizable: false }
  | {
      state: "proven_waiting";
      finalized: false;
      finalizable: false;
      provenAt: bigint;
      disputeGameProxy: string;
      readyAt: bigint;
      reason?: string;
    }
  | {
      state: "finalizable";
      finalized: false;
      finalizable: true;
      provenAt: bigint;
      disputeGameProxy: string;
      readyAt: bigint;
    }
  | { state: "finalized"; finalized: true; finalizable: false };

/** Application-facing stages for a generic DuskEVM-to-Dusk message. */
export type DuskContractCallLifecycleStage =
  | "prepared"
  | "submitted"
  | "confirmed"
  | "proof_not_ready"
  | "prove_ready"
  | "prove_submitted"
  | "proven"
  | "finalizable"
  | "finalize_submitted"
  | "finalized"
  | "delivery_failed"
  | "replay_submitted"
  | "delivered"
  | "failed";

/** Persistable status metadata for a generic L2-to-L1 application call. */
export type DuskContractCallTrackingMetadata = Record<string, JsonValue> & {
  stage: DuskContractCallLifecycleStage;
  targetContractId?: string;
  l2TransactionHash?: string;
  withdrawalHash?: string;
  proveTransactionHash?: string;
  finalizeTransactionHash?: string;
  replayTransactionHash?: string;
  messageHash?: string;
  replayable?: boolean;
};

/** Observations used to derive a resumable generic message lifecycle. */
export type DuskContractCallLifecycleInput = {
  prepared?: PreparedDuskContractCall;
  l2TransactionHash?: TransactionHash;
  message?: ParsedWithdrawalMessage;
  proof?: WithdrawalProofData;
  proveTransactionHash?: TransactionHash;
  proveReceipt?: DuskL1TransactionReceipt;
  finalizeReady?: boolean;
  finalizeNotReadyReason?: string;
  finalizeTransactionHash?: TransactionHash;
  finalizeReceipt?: DuskL1TransactionReceipt;
  portalFinalized?: boolean;
  delivery?: CrossDomainDeliveryState;
  replayTransactionHash?: TransactionHash;
  replayReceipt?: DuskL1TransactionReceipt;
  failure?: string | Error;
  now?: () => number;
};

/** Derive a single lifecycle status without hiding prove, finalize, or replay. */
export function duskContractCallLifecycleStatus(
  input: DuskContractCallLifecycleInput
): BridgeOperationStatus<DuskContractCallTrackingMetadata> {
  const now = input.now ?? Date.now;
  const metadata = baseMetadata(input);

  if (input.failure || input.proveReceipt?.success === false || input.finalizeReceipt?.success === false) {
    return makeStatus("failed", "failed", now(), metadata, errorMessage(input.failure));
  }
  if (input.replayReceipt?.success === false) {
    return makeStatus(
      "accepted",
      "delivery_failed",
      now(),
      { ...metadata, replayable: true },
      "Cross-domain message replay transaction failed"
    );
  }
  if (input.delivery?.state === "delivered") {
    return makeStatus("finalized", "delivered", now(), {
      ...metadata,
      messageHash: input.delivery.messageHash,
      replayable: false,
    });
  }
  if (input.replayTransactionHash || input.replayReceipt) {
    const replayTransactionHash =
      input.replayTransactionHash ?? input.replayReceipt?.transactionHash;
    return makeStatus("submitted", "replay_submitted", now(), {
      ...metadata,
      replayable: true,
      ...(replayTransactionHash ? { replayTransactionHash } : {}),
      ...(input.delivery ? { messageHash: input.delivery.messageHash } : {}),
    });
  }
  if (input.delivery?.state === "delivery_failed") {
    return makeStatus(
      "accepted",
      "delivery_failed",
      now(),
      {
        ...metadata,
        messageHash: input.delivery.messageHash,
        replayable: true,
      },
      "The native receiver rejected the message; the exact message can be replayed"
    );
  }
  if (input.portalFinalized || input.finalizeReceipt?.success === true) {
    return makeStatus(
      "accepted",
      "finalized",
      now(),
      {
        ...metadata,
        ...(input.delivery ? { messageHash: input.delivery.messageHash } : {}),
      },
      "The withdrawal is finalized; Messenger delivery confirmation is pending"
    );
  }

  const withdrawalStatus = withdrawalLifecycleStatus({
    ...(input.l2TransactionHash ? { l2TransactionHash: input.l2TransactionHash } : {}),
    ...(input.message ? { message: input.message } : {}),
    ...(input.proof ? { proof: input.proof } : {}),
    ...(input.proveTransactionHash ? { proveTransactionHash: input.proveTransactionHash } : {}),
    ...(input.proveReceipt ? { proveReceipt: input.proveReceipt } : {}),
    ...(input.finalizeReady === undefined ? {} : { finalizeReady: input.finalizeReady }),
    ...(input.finalizeNotReadyReason
      ? { finalizeNotReadyReason: input.finalizeNotReadyReason }
      : {}),
    ...(input.finalizeTransactionHash
      ? { finalizeTransactionHash: input.finalizeTransactionHash }
      : {}),
    ...(input.finalizeReceipt ? { finalizeReceipt: input.finalizeReceipt } : {}),
    ...(input.failure ? { failure: input.failure } : {}),
    now,
  });
  const mapped = mapWithdrawalStage(withdrawalStatus.metadata!.stage, Boolean(input.message));
  return makeStatus(
    withdrawalStatus.phase,
    mapped,
    withdrawalStatus.updatedAt,
    metadata,
    withdrawalStatus.message
  );
}

/** Read proof maturity and finalization readiness from OptimismPortal. */
export async function readWithdrawalPortalState(params: {
  reader: DuskL1ContractReader;
  portalContractId: string;
  withdrawalHash: Hex;
  proofSubmitter: string;
  latestL1Timestamp: bigint;
}): Promise<WithdrawalPortalState> {
  if (!params.portalContractId.trim()) {
    throw sdkError("INVALID_OPERATION", "OptimismPortal contract id is required");
  }
  const withdrawalHash = normalizeFixedHex(params.withdrawalHash, 32, "withdrawal hash");
  const proofSubmitter = normalizeFixedHex(params.proofSubmitter, 20, "proof submitter");
  const finalized = normalizeBoolean(
    await params.reader.readContract({
      contractId: params.portalContractId,
      method: portalMethods.finalizedWithdrawals.name,
      args: withdrawalHash,
    })
  );
  if (finalized) return { state: "finalized", finalized: true, finalizable: false };

  const proven = await params.reader.readContract({
    contractId: params.portalContractId,
    method: portalMethods.provenWithdrawals.name,
    args: [withdrawalHash, proofSubmitter],
  });
  const disputeGameProxy = normalizeFixedHex(
    tupleValue(proven, "disputeGameProxy", 0),
    20,
    "proven dispute game proxy"
  );
  const provenAt = normalizeBigint(tupleValue(proven, "timestamp", 1), "proven timestamp");
  if (provenAt === 0n || /^0x0{40}$/u.test(disputeGameProxy)) {
    return { state: "unproven", finalized: false, finalizable: false };
  }

  const maturity = normalizeBigint(
    await params.reader.readContract({
      contractId: params.portalContractId,
      method: portalMethods.proofMaturityDelaySeconds.name,
    }),
    "proof maturity delay"
  );
  const readyAt = provenAt + maturity;
  if (params.latestL1Timestamp < readyAt) {
    return {
      state: "proven_waiting",
      finalized: false,
      finalizable: false,
      provenAt,
      disputeGameProxy,
      readyAt,
      reason: "The proof maturity delay has not elapsed yet",
    };
  }

  try {
    await params.reader.readContract({
      contractId: params.portalContractId,
      method: portalMethods.checkWithdrawal.name,
      args: [withdrawalHash, proofSubmitter],
    });
  } catch (error) {
    return {
      state: "proven_waiting",
      finalized: false,
      finalizable: false,
      provenAt,
      disputeGameProxy,
      readyAt,
      reason: error instanceof Error ? error.message : "OptimismPortal rejected finalization",
    };
  }
  return {
    state: "finalizable",
    finalized: false,
    finalizable: true,
    provenAt,
    disputeGameProxy,
    readyAt,
  };
}

function mapWithdrawalStage(stage: string, messageObserved: boolean): DuskContractCallLifecycleStage {
  switch (stage) {
    case "l2_not_submitted":
      return "prepared";
    case "message_not_observed":
      return "submitted";
    case "proof_not_ready":
      return messageObserved ? "proof_not_ready" : "confirmed";
    case "prove_ready":
      return "prove_ready";
    case "prove_submitted":
      return "prove_submitted";
    case "proven":
    case "finalize_not_ready":
      return "proven";
    case "finalize_ready":
      return "finalizable";
    case "finalize_submitted":
      return "finalize_submitted";
    case "finalized":
      return "finalized";
    default:
      return "failed";
  }
}

function baseMetadata(input: DuskContractCallLifecycleInput): DuskContractCallTrackingMetadata {
  const metadata: DuskContractCallTrackingMetadata = { stage: "prepared" };
  if (input.prepared) {
    metadata.targetContractId = input.prepared.targetContractId;
  }
  const l2Hash = input.l2TransactionHash ?? input.message?.transactionHash;
  if (l2Hash) metadata.l2TransactionHash = l2Hash;
  if (input.message) metadata.withdrawalHash = input.message.withdrawalHash;
  const proveHash = input.proveTransactionHash ?? input.proveReceipt?.transactionHash;
  if (proveHash) metadata.proveTransactionHash = proveHash;
  const finalizeHash = input.finalizeTransactionHash ?? input.finalizeReceipt?.transactionHash;
  if (finalizeHash) metadata.finalizeTransactionHash = finalizeHash;
  return metadata;
}

function makeStatus(
  phase: BridgeOperationStatus["phase"],
  stage: DuskContractCallLifecycleStage,
  updatedAt: number,
  metadata: DuskContractCallTrackingMetadata,
  message?: string
): BridgeOperationStatus<DuskContractCallTrackingMetadata> {
  return {
    phase,
    updatedAt,
    metadata: { ...metadata, stage },
    ...(message ? { message } : {}),
  };
}

function errorMessage(error: string | Error | undefined): string | undefined {
  if (!error) return undefined;
  return typeof error === "string" ? error : error.message;
}

function tupleValue(value: unknown, key: string, index: number): unknown {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown> & { [index: number]: unknown };
  return record[key] ?? record[index];
}

function normalizeFixedHex(value: unknown, bytes: number, label: string): Hex {
  if (typeof value === "string" && new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`, "u").test(value)) {
    return value.toLowerCase() as Hex;
  }
  if (value instanceof Uint8Array && value.length === bytes) return toHex(value);
  if (
    Array.isArray(value) &&
    value.length === bytes &&
    value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    return toHex(Uint8Array.from(value as number[]));
  }
  throw sdkError("CLIENT_ERROR", `${label} must be ${bytes} bytes`, value);
}

function normalizeBigint(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^(?:0x[0-9a-fA-F]+|[0-9]+)$/u.test(value)) return BigInt(value);
  if (value instanceof Uint8Array || Array.isArray(value)) {
    const bytes = value instanceof Uint8Array ? value : Uint8Array.from(value as number[]);
    let out = 0n;
    for (const byte of bytes) out = (out << 8n) | BigInt(byte);
    return out;
  }
  throw sdkError("CLIENT_ERROR", `${label} is not an integer`, value);
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 0n || value === "0" || value === "0x0") return false;
  if (value === 1 || value === 1n || value === "1" || value === "0x1") return true;
  throw sdkError("CLIENT_ERROR", "Portal returned a non-boolean finalized flag", value);
}
