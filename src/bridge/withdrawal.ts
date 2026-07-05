import {
  decodeEventLog,
  encodeAbiParameters,
  keccak256,
  toEventSelector,
  type Hex,
} from "viem";
import {
  encodeDuskDeliveryEnvelope,
  type EncodeDuskDeliveryEnvelopeOptions,
} from "../envelope/index.js";
import { sdkError } from "../errors.js";
import { normalizeEvmAddress } from "../evm-address.js";
import {
  submitDuskL1Transaction,
  type DuskL1Client,
  type DuskL1SubmitOptions,
  type DuskL1TransactionReceipt,
  type DuskL1TransactionRequest,
  type SubmittedDuskL1Transaction,
} from "../l1/index.js";
import {
  encodeL2Drc20WithdrawalCall,
  encodeL2Drc721WithdrawalCall,
  encodeL2NativeWithdrawalCall,
  L2_TO_L1_MESSAGE_PASSER_ADDRESS,
  l2ToL1MessagePasserAbi,
  type DuskEvmPreparedCall,
} from "../l2/index.js";
import type { BridgeOperationStatus } from "../status/index.js";
import type { EvmAddress, JsonValue, TransactionHash } from "../types.js";
import { normalizeUint32 } from "../uint32.js";
import { normalizeUint256 } from "../uint256.js";
import { createBridgeOperationId } from "./operation-id.js";

export const MESSAGE_PASSED_EVENT_TOPIC = toEventSelector(
  "MessagePassed(uint256,address,address,uint256,uint256,bytes,bytes32)"
);

export const DEFAULT_WITHDRAWAL_MIN_GAS_LIMIT = 200_000;

export type WithdrawalAsset =
  | {
      kind: "native";
      amountWei: bigint;
    }
  | {
      kind: "drc20";
      l1Token?: EvmAddress;
      l2Token: EvmAddress;
      amount: bigint;
    }
  | {
      kind: "drc721";
      l1Token: EvmAddress;
      l2Token: EvmAddress;
      tokenId: string | bigint;
    };

export type WithdrawalExtraDataParams = {
  extraData?: Hex;
  delivery?: EncodeDuskDeliveryEnvelopeOptions;
};

export type WithdrawalBaseParams = WithdrawalExtraDataParams & {
  /** OP bridge recipient used in the L2 withdrawal call; `delivery` only controls extraData. */
  recipient: EvmAddress;
  minGasLimit?: number;
  metadata?: Record<string, JsonValue>;
};

export type NativeWithdrawalParams = WithdrawalBaseParams & {
  amountWei: bigint;
};

export type Drc20WithdrawalParams = WithdrawalBaseParams & {
  l1Token?: EvmAddress;
  l2Token: EvmAddress;
  amount: bigint;
};

export type Drc721WithdrawalParams = WithdrawalBaseParams & {
  l1Token: EvmAddress;
  l2Token: EvmAddress;
  tokenId: string | bigint;
};

export type PreparedWithdrawalOperation = {
  id: string;
  direction: "l2-to-l1";
  asset: WithdrawalAsset;
  recipient: EvmAddress;
  minGasLimit: number;
  extraData: Hex;
  l2Transaction: DuskEvmPreparedCall;
  metadata: Record<string, JsonValue>;
};

export type WithdrawalTransaction = {
  nonce: bigint;
  sender: EvmAddress;
  target: EvmAddress;
  value: bigint;
  gasLimit: bigint;
  data: Hex;
};

export type EncodedWithdrawalTransaction = {
  nonce: Hex;
  sender: EvmAddress;
  target: EvmAddress;
  value: Hex;
  gas_limit: Hex;
  data: Hex;
};

export type OutputRootProof = {
  version: Hex;
  stateRoot: Hex;
  messagePasserStorageRoot: Hex;
  latestBlockhash: Hex;
};

export type EncodedOutputRootProof = {
  version: Hex;
  state_root: Hex;
  message_passer_storage_root: Hex;
  latest_blockhash: Hex;
};

export type WithdrawalProofData = {
  disputeGameIndex: bigint | number | string;
  outputRootProof: OutputRootProof;
  withdrawalProof: readonly Hex[];
};

export type ParsedWithdrawalMessage = {
  withdrawal: WithdrawalTransaction;
  withdrawalHash: Hex;
  blockNumber?: bigint;
  transactionHash?: TransactionHash;
  logIndex?: number;
};

export type EvmLogLike = {
  address?: string | null;
  topics?: readonly Hex[] | null;
  data?: Hex | null;
  blockNumber?: bigint | number | string | null;
  transactionHash?: string | null;
  logIndex?: bigint | number | string | null;
};

export type EvmReceiptLike = {
  logs?: readonly EvmLogLike[] | null;
  blockNumber?: bigint | number | string | null;
  transactionHash?: string | null;
};

export type BuildProveWithdrawalTransactionParams = WithdrawalProofData & {
  portalContractId: string;
  withdrawal: WithdrawalTransaction;
  gasLimit?: bigint;
  gasPriceLux?: bigint;
  metadata?: Record<string, JsonValue>;
};

export type BuildFinalizeWithdrawalTransactionParams = {
  portalContractId: string;
  withdrawal: WithdrawalTransaction;
  proofSubmitter?: EvmAddress;
  gasLimit?: bigint;
  gasPriceLux?: bigint;
  metadata?: Record<string, JsonValue>;
};

export type WithdrawalLifecycleStage =
  | "l2_not_submitted"
  | "message_not_observed"
  | "proof_not_ready"
  | "prove_ready"
  | "prove_submitted"
  | "proven"
  | "finalize_not_ready"
  | "finalize_ready"
  | "finalize_submitted"
  | "finalized"
  | "failed";

export type WithdrawalTrackingMetadata = Record<string, JsonValue> & {
  stage: WithdrawalLifecycleStage;
  operationId?: string;
  withdrawalHash?: string;
  l2TransactionHash?: string;
  l2BlockNumber?: string;
  proveTransactionHash?: string;
  finalizeTransactionHash?: string;
  reason?: string;
};

export type WithdrawalLifecycleStatus = BridgeOperationStatus<WithdrawalTrackingMetadata>;

export type WithdrawalLifecycleStatusInput = {
  operation?: PreparedWithdrawalOperation;
  l2TransactionHash?: TransactionHash;
  message?: ParsedWithdrawalMessage;
  proof?: WithdrawalProofData;
  proveTransactionHash?: TransactionHash;
  proveReceipt?: DuskL1TransactionReceipt;
  finalizeReady?: boolean;
  finalizeNotReadyReason?: string;
  finalizeTransactionHash?: TransactionHash;
  finalizeReceipt?: DuskL1TransactionReceipt;
  failure?: string | Error;
  now?: () => number;
};

type PreparedWithdrawalInput = {
  asset: WithdrawalAsset;
  recipient: EvmAddress;
  minGasLimit: number;
  extraData: Hex;
  l2Transaction: DuskEvmPreparedCall;
  metadata?: Record<string, JsonValue>;
};

export function prepareNativeWithdrawal(params: NativeWithdrawalParams): PreparedWithdrawalOperation {
  const extraData = withdrawalExtraData(params);
  const minGasLimit = withdrawalMinGasLimit(params.minGasLimit);
  const recipient = normalizeEvmAddress(params.recipient, "Withdrawal recipient");
  const amountWei = normalizeUint256(params.amountWei, "Withdrawal native amount");
  const asset: WithdrawalAsset = { kind: "native", amountWei };
  return preparedWithdrawal(
    withWithdrawalMetadata(
      {
        asset,
        recipient,
        minGasLimit,
        extraData,
        l2Transaction: encodeL2NativeWithdrawalCall({
          recipient,
          amountWei,
          minGasLimit,
          extraData,
        }),
      },
      params.metadata
    )
  );
}

export function prepareDrc20Withdrawal(params: Drc20WithdrawalParams): PreparedWithdrawalOperation {
  const extraData = withdrawalExtraData(params);
  const minGasLimit = withdrawalMinGasLimit(params.minGasLimit);
  const recipient = normalizeEvmAddress(params.recipient, "Withdrawal recipient");
  const l2Token = normalizeEvmAddress(params.l2Token, "Withdrawal L2 token");
  const amount = normalizeUint256(params.amount, "Withdrawal DRC20 amount");
  const asset: Extract<WithdrawalAsset, { kind: "drc20" }> = {
    kind: "drc20",
    l2Token,
    amount,
  };
  if (params.l1Token !== undefined) {
    asset.l1Token = normalizeEvmAddress(params.l1Token, "Withdrawal L1 token");
  }
  return preparedWithdrawal(
    withWithdrawalMetadata(
      {
        asset,
        recipient,
        minGasLimit,
        extraData,
        l2Transaction: encodeL2Drc20WithdrawalCall({
          l2Token,
          recipient,
          amount,
          minGasLimit,
          extraData,
        }),
      },
      params.metadata
    )
  );
}

export function prepareDrc721Withdrawal(params: Drc721WithdrawalParams): PreparedWithdrawalOperation {
  const extraData = withdrawalExtraData(params);
  const minGasLimit = withdrawalMinGasLimit(params.minGasLimit);
  const recipient = normalizeEvmAddress(params.recipient, "Withdrawal recipient");
  const l1Token = normalizeEvmAddress(params.l1Token, "Withdrawal L1 token");
  const l2Token = normalizeEvmAddress(params.l2Token, "Withdrawal L2 token");
  const tokenId = normalizeUint256(params.tokenId, "Withdrawal DRC721 tokenId");
  const asset: WithdrawalAsset = {
    kind: "drc721",
    l1Token,
    l2Token,
    tokenId,
  };
  return preparedWithdrawal(
    withWithdrawalMetadata(
      {
        asset,
        recipient,
        minGasLimit,
        extraData,
        l2Transaction: encodeL2Drc721WithdrawalCall({
          l1Token,
          l2Token,
          recipient,
          tokenId,
          minGasLimit,
          extraData,
        }),
      },
      params.metadata
    )
  );
}

export function parseMessagePassedLog(log: EvmLogLike): ParsedWithdrawalMessage | undefined {
  if (!log.address || !log.address.toLowerCase().startsWith("0x")) return undefined;
  if (log.address.toLowerCase() !== L2_TO_L1_MESSAGE_PASSER_ADDRESS.toLowerCase()) {
    return undefined;
  }

  const topics = log.topics;
  if (!topics?.[0] || topics[0].toLowerCase() !== MESSAGE_PASSED_EVENT_TOPIC.toLowerCase()) {
    return undefined;
  }
  if (!log.data) throw sdkError("INVALID_OPERATION", "MessagePassed log is missing data");

  let decoded: ReturnType<typeof decodeEventLog>;
  try {
    decoded = decodeEventLog({
      abi: l2ToL1MessagePasserAbi,
      data: log.data,
      topics: topics as [Hex, ...Hex[]],
    });
  } catch (error) {
    throw sdkError("INVALID_OPERATION", "MessagePassed log could not be decoded", error);
  }
  if (decoded.eventName !== "MessagePassed") return undefined;

  const args = decoded.args as unknown as {
    nonce: bigint;
    sender: EvmAddress;
    target: EvmAddress;
    value: bigint;
    gasLimit: bigint;
    data: Hex;
    withdrawalHash: Hex;
  };
  const withdrawal: WithdrawalTransaction = {
    nonce: args.nonce,
    sender: args.sender,
    target: args.target,
    value: args.value,
    gasLimit: args.gasLimit,
    data: normalizeByteHex(args.data, "MessagePassed data"),
  };
  const withdrawalHash = normalizeBytes32(args.withdrawalHash, "MessagePassed withdrawalHash");
  const computed = hashWithdrawal(withdrawal);
  if (computed.toLowerCase() !== withdrawalHash.toLowerCase()) {
    throw sdkError("INVALID_OPERATION", "MessagePassed withdrawalHash does not match event payload");
  }

  const parsed: ParsedWithdrawalMessage = {
    withdrawal,
    withdrawalHash,
  };
  const blockNumber = optionalBigint(log.blockNumber);
  if (blockNumber !== undefined) parsed.blockNumber = blockNumber;
  if (log.transactionHash) parsed.transactionHash = log.transactionHash;
  const logIndex = optionalNumber(log.logIndex);
  if (logIndex !== undefined) parsed.logIndex = logIndex;
  return parsed;
}

export function parseMessagePassedReceipt(receipt: EvmReceiptLike): ParsedWithdrawalMessage {
  for (const log of receipt.logs ?? []) {
    const logWithReceiptFields: EvmLogLike = { ...log };
    const blockNumber = log.blockNumber ?? receipt.blockNumber;
    if (blockNumber !== undefined) logWithReceiptFields.blockNumber = blockNumber;
    const transactionHash = log.transactionHash ?? receipt.transactionHash;
    if (transactionHash !== undefined) logWithReceiptFields.transactionHash = transactionHash;
    const parsed = parseMessagePassedLog(logWithReceiptFields);
    if (parsed) return parsed;
  }
  throw sdkError("INVALID_OPERATION", "No MessagePassed event found in receipt");
}

function normalizeWithdrawalTransaction(withdrawal: WithdrawalTransaction): WithdrawalTransaction {
  return {
    ...withdrawal,
    sender: normalizeEvmAddress(withdrawal.sender, "withdrawal sender"),
    target: normalizeEvmAddress(withdrawal.target, "withdrawal target"),
    data: normalizeByteHex(withdrawal.data, "withdrawal data"),
  };
}

export function encodeWithdrawal(withdrawal: WithdrawalTransaction): Hex {
  const normalized = normalizeWithdrawalTransaction(withdrawal);
  return encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes" },
    ],
    [
      normalized.nonce,
      normalized.sender,
      normalized.target,
      normalized.value,
      normalized.gasLimit,
      normalized.data,
    ]
  );
}

export function hashWithdrawal(withdrawal: WithdrawalTransaction): Hex {
  return normalizeBytes32(keccak256(encodeWithdrawal(withdrawal)), "withdrawal hash");
}

export function serializeWithdrawalForDuskAbi(
  withdrawal: WithdrawalTransaction
): EncodedWithdrawalTransaction {
  const normalized = normalizeWithdrawalTransaction(withdrawal);
  return {
    nonce: toU256Hex(normalized.nonce, "withdrawal nonce"),
    sender: normalized.sender,
    target: normalized.target,
    value: toU256Hex(normalized.value, "withdrawal value"),
    gas_limit: toU256Hex(normalized.gasLimit, "withdrawal gasLimit"),
    data: normalized.data,
  };
}

export function serializeOutputRootProofForDuskAbi(
  proof: OutputRootProof
): EncodedOutputRootProof {
  return {
    version: normalizeBytes32(proof.version, "output root proof version"),
    state_root: normalizeBytes32(proof.stateRoot, "output root proof stateRoot"),
    message_passer_storage_root: normalizeBytes32(
      proof.messagePasserStorageRoot,
      "output root proof messagePasserStorageRoot"
    ),
    latest_blockhash: normalizeBytes32(proof.latestBlockhash, "output root proof latestBlockhash"),
  };
}

export function buildProveWithdrawalTransaction(
  params: BuildProveWithdrawalTransactionParams
): DuskL1TransactionRequest {
  const request = withdrawalL1Request(params, "proveWithdrawalTransaction", [
    serializeWithdrawalForDuskAbi(params.withdrawal),
    toU256Hex(params.disputeGameIndex, "dispute game index"),
    serializeOutputRootProofForDuskAbi(params.outputRootProof),
    params.withdrawalProof.map((node) => normalizeByteHex(node, "withdrawal proof node")),
  ]);
  return request;
}

export function buildFinalizeWithdrawalTransaction(
  params: BuildFinalizeWithdrawalTransactionParams
): DuskL1TransactionRequest {
  const withdrawal = serializeWithdrawalForDuskAbi(params.withdrawal);
  const proofSubmitter =
    params.proofSubmitter === undefined
      ? undefined
      : normalizeEvmAddress(params.proofSubmitter, "withdrawal proof submitter");
  return withdrawalL1Request(
    params,
    proofSubmitter
      ? "finalizeWithdrawalTransactionExternalProof"
      : "finalizeWithdrawalTransaction",
    proofSubmitter ? [withdrawal, proofSubmitter] : [withdrawal]
  );
}

export async function submitProveWithdrawalTransaction(
  client: DuskL1Client,
  params: BuildProveWithdrawalTransactionParams,
  options?: DuskL1SubmitOptions
): Promise<SubmittedDuskL1Transaction> {
  return submitDuskL1Transaction(client, buildProveWithdrawalTransaction(params), options);
}

export async function submitFinalizeWithdrawalTransaction(
  client: DuskL1Client,
  params: BuildFinalizeWithdrawalTransactionParams,
  options?: DuskL1SubmitOptions
): Promise<SubmittedDuskL1Transaction> {
  return submitDuskL1Transaction(client, buildFinalizeWithdrawalTransaction(params), options);
}

export function withdrawalLifecycleStatus(
  input: WithdrawalLifecycleStatusInput
): WithdrawalLifecycleStatus {
  const now = input.now ?? Date.now;
  const base = withdrawalMetadata(input);
  const finalizeTransactionHash =
    input.finalizeTransactionHash ?? input.finalizeReceipt?.transactionHash;
  const proveTransactionHash = input.proveTransactionHash ?? input.proveReceipt?.transactionHash;

  if (input.failure) {
    return status("failed", "failed", now(), base, errorMessage(input.failure));
  }
  if (input.finalizeReceipt?.success === false || input.proveReceipt?.success === false) {
    return status("failed", "failed", now(), base, "Withdrawal L1 transaction failed");
  }
  if (input.finalizeReceipt?.success === true && input.finalizeReceipt.finalized === true) {
    return status("finalized", "finalized", now(), base);
  }
  if (input.finalizeReceipt?.success === true) {
    return status(
      "accepted",
      "finalize_submitted",
      now(),
      base,
      "Finalize transaction succeeded but is not finalized yet"
    );
  }
  if (input.finalizeReceipt?.finalized === true) {
    return status(
      "submitted",
      "finalize_submitted",
      now(),
      base,
      "Finalize receipt is finalized but successful execution is not confirmed"
    );
  }
  if (finalizeTransactionHash) {
    return status("submitted", "finalize_submitted", now(), base);
  }
  if (input.finalizeReady === true) {
    return status("accepted", "finalize_ready", now(), base);
  }
  if (input.proveReceipt?.success === true && input.proveReceipt.finalized === true) {
    if (input.finalizeNotReadyReason) {
      return status("accepted", "finalize_not_ready", now(), base, input.finalizeNotReadyReason);
    }
    return status("accepted", "proven", now(), base);
  }
  if (input.proveReceipt?.success === true) {
    return status(
      "accepted",
      "prove_submitted",
      now(),
      base,
      "Prove transaction succeeded but is not finalized yet"
    );
  }
  if (input.proveReceipt?.finalized === true) {
    return status(
      "submitted",
      "prove_submitted",
      now(),
      base,
      "Prove receipt is finalized but successful execution is not confirmed"
    );
  }
  if (proveTransactionHash) {
    return status("submitted", "prove_submitted", now(), base);
  }
  if (input.proof && input.message) {
    return status("accepted", "prove_ready", now(), base);
  }
  if (input.message) {
    return status("accepted", "proof_not_ready", now(), base, "Withdrawal proof is not available yet");
  }
  if (input.l2TransactionHash) {
    return status(
      "submitted",
      "message_not_observed",
      now(),
      base,
      "L2 transaction submitted but MessagePassed is not observed yet"
    );
  }
  return status("prepared", "l2_not_submitted", now(), base, "L2 withdrawal is not submitted yet");
}

function preparedWithdrawal(input: PreparedWithdrawalInput): PreparedWithdrawalOperation {
  const payload = withdrawalOperationIdPayload(input.asset, input.recipient, input.minGasLimit, input.extraData);
  return {
    id: createBridgeOperationId("withdrawal", payload),
    direction: "l2-to-l1",
    asset: input.asset,
    recipient: input.recipient,
    minGasLimit: input.minGasLimit,
    extraData: input.extraData,
    l2Transaction: input.l2Transaction,
    metadata: {
      ...(input.metadata ?? {}),
      recipient: input.recipient,
      minGasLimit: input.minGasLimit,
      extraData: input.extraData,
    },
  };
}

function withWithdrawalMetadata(
  input: Omit<PreparedWithdrawalInput, "metadata">,
  metadata: Record<string, JsonValue> | undefined
): PreparedWithdrawalInput {
  if (metadata === undefined) return input;
  return { ...input, metadata };
}

function withdrawalOperationIdPayload(
  asset: WithdrawalAsset,
  recipient: EvmAddress,
  minGasLimit: number,
  extraData: Hex
): JsonValue {
  const base = {
    prefix: "withdrawal",
    recipient: recipient.toLowerCase(),
    minGasLimit,
    extraData: extraData.toLowerCase(),
  };

  switch (asset.kind) {
    case "native":
      return {
        ...base,
        asset: {
          kind: asset.kind,
          amountWei: asset.amountWei.toString(),
        },
      };
    case "drc20":
      return {
        ...base,
        asset: {
          kind: asset.kind,
          l2Token: asset.l2Token.toLowerCase(),
          amount: asset.amount.toString(),
        },
      };
    case "drc721":
      return {
        ...base,
        asset: {
          kind: asset.kind,
          l1Token: asset.l1Token.toLowerCase(),
          l2Token: asset.l2Token.toLowerCase(),
          tokenId: asset.tokenId.toString(),
        },
      };
  }
}

function withdrawalExtraData(params: WithdrawalExtraDataParams): Hex {
  if (params.extraData !== undefined && params.delivery !== undefined) {
    throw sdkError("INVALID_OPERATION", "Use either withdrawal extraData or delivery, not both");
  }
  if (params.delivery) return encodeDuskDeliveryEnvelope(params.delivery);
  return normalizeByteHex(params.extraData ?? "0x", "withdrawal extraData");
}

function withdrawalMinGasLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_WITHDRAWAL_MIN_GAS_LIMIT;
  return normalizeUint32(value, "Withdrawal minGasLimit");
}

function withdrawalL1Request(
  params: {
    portalContractId: string;
    withdrawal: WithdrawalTransaction;
    gasLimit?: bigint;
    gasPriceLux?: bigint;
    metadata?: Record<string, JsonValue>;
  },
  method: string,
  args: JsonValue
): DuskL1TransactionRequest {
  if (!params.portalContractId) {
    throw sdkError("UNSUPPORTED", "OptimismPortal2 contract id is required");
  }
  const request: DuskL1TransactionRequest = {
    kind: "contract_call",
    contractId: params.portalContractId,
    method,
    args,
    metadata: {
      ...(params.metadata ?? {}),
      bridgeDirection: "l2-to-l1",
      withdrawalHash: hashWithdrawal(params.withdrawal),
    },
  };
  if (params.gasLimit !== undefined) request.gasLimit = params.gasLimit;
  if (params.gasPriceLux !== undefined) request.gasPriceLux = params.gasPriceLux;
  return request;
}

function withdrawalMetadata(input: WithdrawalLifecycleStatusInput): WithdrawalTrackingMetadata {
  const metadata: WithdrawalTrackingMetadata = {
    stage: "l2_not_submitted",
  };
  if (input.operation) metadata.operationId = input.operation.id;
  const l2TransactionHash = input.l2TransactionHash ?? input.message?.transactionHash;
  if (l2TransactionHash) metadata.l2TransactionHash = l2TransactionHash;
  if (input.message?.withdrawalHash) metadata.withdrawalHash = input.message.withdrawalHash;
  if (input.message?.blockNumber !== undefined) {
    metadata.l2BlockNumber = input.message.blockNumber.toString();
  }
  const proveTransactionHash = input.proveTransactionHash ?? input.proveReceipt?.transactionHash;
  if (proveTransactionHash) metadata.proveTransactionHash = proveTransactionHash;
  const finalizeTransactionHash =
    input.finalizeTransactionHash ?? input.finalizeReceipt?.transactionHash;
  if (finalizeTransactionHash) {
    metadata.finalizeTransactionHash = finalizeTransactionHash;
  }
  return metadata;
}

function status(
  phase: WithdrawalLifecycleStatus["phase"],
  stage: WithdrawalLifecycleStage,
  updatedAt: number,
  metadata: WithdrawalTrackingMetadata,
  reason?: string
): WithdrawalLifecycleStatus {
  metadata.stage = stage;
  if (reason !== undefined) metadata.reason = reason;
  const out: WithdrawalLifecycleStatus = {
    phase,
    updatedAt,
    metadata,
  };
  if (reason !== undefined) out.message = reason;
  return out;
}

function errorMessage(error: string | Error): string {
  return typeof error === "string" ? error : error.message;
}

function normalizeByteHex(value: Hex, label: string): Hex {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(value)) {
    throw sdkError("INVALID_OPERATION", `${label} must be 0x-prefixed byte hex`);
  }
  return `0x${value.slice(2).toLowerCase()}`;
}

function normalizeBytes32(value: Hex, label: string): Hex {
  const hex = normalizeByteHex(value, label);
  if (hex.length !== 66) throw sdkError("INVALID_OPERATION", `${label} must be 32 bytes`);
  return hex;
}

function toU256Hex(value: bigint | number | string, label: string): Hex {
  let bigintValue: bigint;
  if (typeof value === "bigint") {
    bigintValue = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw sdkError("INVALID_OPERATION", `${label} must be a safe integer`);
    }
    bigintValue = BigInt(value);
  } else if (/^0[xX][0-9a-fA-F]+$/.test(value)) {
    if (value.length > 66) throw sdkError("INVALID_OPERATION", `${label} does not fit uint256`);
    return `0x${value.slice(2).padStart(64, "0").toLowerCase()}`;
  } else if (/^\d+$/.test(value)) {
    bigintValue = BigInt(value);
  } else {
    throw sdkError("INVALID_OPERATION", `${label} must be a uint256 value`);
  }

  if (bigintValue < 0n || bigintValue >= 1n << 256n) {
    throw sdkError("INVALID_OPERATION", `${label} does not fit uint256`);
  }
  return `0x${bigintValue.toString(16).padStart(64, "0")}`;
}

function optionalBigint(value: bigint | number | string | null | undefined): bigint | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^0[xX][0-9a-fA-F]+$/.test(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return undefined;
}

function optionalNumber(value: bigint | number | string | null | undefined): number | undefined {
  const asBigint = optionalBigint(value);
  if (asBigint === undefined || asBigint > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(asBigint);
}
