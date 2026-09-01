import type { Hex } from "viem";
import {
  observeDepositStatus,
  parseMessagePassedReceipt,
  resolveDuskTransactionHash,
  type DepositReceiptClient,
  type DepositTrackingMetadata,
  type DuskTransactionProjectionClient,
  type EvmReceiptLike,
  type ParsedWithdrawalMessage,
} from "../bridge/index.js";
import { sdkError } from "../errors.js";
import {
  L2_CROSS_DOMAIN_MESSENGER_ADDRESS,
  prepareDuskContractCall,
  type DuskEvmPreparedCall,
  type PrepareDuskContractCallOptions,
  type PreparedDuskContractCall,
} from "../l2/index.js";
import { pollOperationStatus, type BridgeOperationStatus } from "../status/index.js";
import type { EvmAddress, JsonValue, TransactionHash } from "../types.js";
import {
  hashDuskCrossDomainMessage,
  parseCrossDomainMessageFromWithdrawal,
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
  wait?: boolean;
};

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

  const receipt = await options.publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status === "reverted" || receipt.status === "0x0") {
    throw sdkError("TRANSACTION_FAILED", "DuskEVM contract-call transaction reverted", receipt);
  }
  const withdrawal = parseMessagePassedReceipt(receipt);
  const crossDomainMessage = parseCrossDomainMessageFromWithdrawal(withdrawal.withdrawal);
  return {
    ...result,
    receipt,
    withdrawal,
    crossDomainMessage,
    messageHash: hashDuskCrossDomainMessage(crossDomainMessage),
  };
}

/** Observe a Dusk-to-DuskEVM Messenger call using standard OP deposit tracking. */
export async function observeDuskEvmContractCallStatus(params: {
  l1Client: DepositReceiptClient & DuskTransactionProjectionClient;
  l2Client: DepositReceiptClient & Pick<DuskContractCallPublicClient, "getChainId" | "getBytecode">;
  duskTransactionHash: string;
  expectedChainId: number;
  metadata?: Record<string, JsonValue>;
  now?: () => number;
}): Promise<BridgeOperationStatus<DuskEvmContractCallTrackingMetadata>> {
  await validateDuskEvmDeployment({
    client: params.l2Client,
    expectedChainId: params.expectedChainId,
  });
  const duskTransactionHash = normalizeTransactionHash(params.duskTransactionHash);
  const l1TransactionHash = await resolveDuskTransactionHash(
    params.l1Client,
    duskTransactionHash
  );
  if (l1TransactionHash === null) {
    return {
      phase: "submitted",
      updatedAt: (params.now ?? Date.now)(),
      metadata: {
        ...(params.metadata ?? {}),
        xdmDirection: "dusk-to-duskevm",
        duskTransactionHash,
        stage: "l1_pending",
      },
    };
  }
  const status = await observeDepositStatus({
    l1Client: params.l1Client,
    l2Client: params.l2Client,
    l1TransactionHash: normalizeTransactionHash(l1TransactionHash),
    metadata: {
      ...(params.metadata ?? {}),
      xdmDirection: "dusk-to-duskevm",
      duskTransactionHash,
    },
    ...(params.now === undefined ? {} : { now: params.now }),
  });
  return {
    ...status,
    metadata: { ...status.metadata, duskTransactionHash },
  };
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
