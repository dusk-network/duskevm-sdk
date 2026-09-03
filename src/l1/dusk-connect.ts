import { sdkError } from "../errors.js";
import type { JsonValue, MaybePromise, TransactionHash } from "../types.js";
import type {
  DuskL1Client,
  DuskL1ContractReadRequest,
  DuskL1ContractReader,
  DuskL1SubmittedTransaction,
  DuskL1TransactionReceipt,
  DuskL1TransactionRequest,
  WaitForDuskTransactionOptions,
} from "./types.js";

/** Privacy rail accepted by current Dusk Connect transaction requests. */
export type DuskConnectPrivacy = "public" | "shielded";

/** Encoded contract arguments accepted by Dusk Connect. */
export type DuskConnectByteLike = string | number[] | Uint8Array | ArrayBuffer;

/** Gas override accepted by current Dusk Connect transaction requests. */
export type DuskConnectGas = { limit: string; price: string };

/** Data-driver-backed contract reference accepted by DuskApp. */
export type DuskConnectContractReference =
  | string
  | { contractId: string; driverUrl: string };

/** Current Dusk Connect transaction request subset emitted by this adapter. */
export type DuskConnectTransactionRequest =
  | {
      kind: "transfer";
      privacy: DuskConnectPrivacy;
      to: string;
      amount: string;
      gas?: DuskConnectGas;
      display?: unknown;
    }
  | {
      kind: "contract_call";
      privacy: DuskConnectPrivacy;
      contractId: string;
      fnName: string;
      fnArgs: DuskConnectByteLike;
      gas?: DuskConnectGas;
      display?: unknown;
    };

/** Minimal current Dusk Connect wallet API consumed by the SDK. */
export type DuskConnectLikeWallet = {
  sendTransaction(request: DuskConnectTransactionRequest): Promise<unknown>;
  getGasPrice?(options?: { maxTransactions?: number }): Promise<unknown>;
};

/** Minimal data-driver-backed Dusk Connect app API consumed by the SDK. */
export type DuskConnectLikeApp = {
  wallet: DuskConnectLikeWallet;
  writeContract(request: {
    contract: DuskConnectContractReference;
    functionName: string;
    args?: JsonValue;
    privacy: DuskConnectPrivacy;
    gas?: DuskConnectGas;
    display?: unknown;
  }): Promise<unknown>;
  readContract?(request: {
    contract: DuskConnectContractReference;
    functionName: string;
    args?: JsonValue;
  }): Promise<unknown>;
  waitForTxReceipt?(
    transactionHash: TransactionHash,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<unknown>;
};

/** Options used to adapt the current Dusk Connect wallet or app facade. */
export type CreateDuskConnectL1ClientOptions = {
  privacy: DuskConnectPrivacy;
  maxGasPriceTransactions?: number;
  /** Resolve a contract ID to a DuskApp preset or inline data-driver configuration. */
  resolveContract?: (contractId: string) => DuskConnectContractReference;
  /** Encode logical SDK arguments when adapting the low-level wallet instead of DuskApp. */
  encodeContractCall?: (request: DuskL1ContractReadRequest) => MaybePromise<DuskConnectByteLike>;
  readContract?: DuskL1ContractReader["readContract"];
  waitForTransaction?: (
    transactionHash: TransactionHash,
    options?: WaitForDuskTransactionOptions
  ) => Promise<unknown>;
};

/** Adapt the current Dusk Connect wallet or DuskApp facade to the SDK L1 client. */
export function createDuskConnectL1Client(
  connect: DuskConnectLikeWallet | DuskConnectLikeApp,
  options: CreateDuskConnectL1ClientOptions
): DuskL1Client {
  requirePrivacy(options.privacy);
  const app = isDuskConnectApp(connect) ? connect : undefined;
  const wallet: DuskConnectLikeWallet = app
    ? app.wallet
    : (connect as DuskConnectLikeWallet);
  if (app && !options.resolveContract) {
    throw sdkError("UNSUPPORTED", "DuskApp integration requires a contract resolver");
  }
  if (!app && !options.encodeContractCall) {
    throw sdkError(
      "UNSUPPORTED",
      "Low-level Dusk wallet integration requires an encoded contract-call adapter"
    );
  }

  const submittedHandles = new Map<TransactionHash, unknown>();
  const readContract = resolveReadContract(app, options);

  return {
    async submitTransaction(request) {
      const raw = app
        ? await submitWithApp(app, options, request)
        : await wallet.sendTransaction(await toWalletRequest(request, options));
      const submitted = normalizeSubmittedTransaction(raw);
      if (hasWaitMethod(raw)) submittedHandles.set(submitted.transactionHash, raw);
      return submitted;
    },
    async getGasPriceLux() {
      if (!wallet.getGasPrice) return undefined;
      const gasOptions =
        options.maxGasPriceTransactions === undefined
          ? undefined
          : { maxTransactions: options.maxGasPriceTransactions };
      return normalizeGasPrice(await wallet.getGasPrice(gasOptions));
    },
    async waitForTransaction(transactionHash, waitOptions) {
      const handle = submittedHandles.get(transactionHash);
      let raw: unknown;
      try {
        raw = handle
          ? await waitOnHandle(handle, waitOptions)
          : options.waitForTransaction
            ? await options.waitForTransaction(transactionHash, waitOptions)
            : app?.waitForTxReceipt
              ? await app.waitForTxReceipt(transactionHash, connectWaitOptions(waitOptions))
              : undefined;
      } finally {
        if (handle) submittedHandles.delete(transactionHash);
      }
      if (raw === undefined) {
        throw sdkError(
          "UNSUPPORTED",
          "Dusk Connect integration requires a transaction handle or waitForTransaction adapter"
        );
      }
      return normalizeReceipt(transactionHash, raw);
    },
    ...(readContract === undefined ? {} : { readContract }),
  };
}

function isDuskConnectApp(
  connect: DuskConnectLikeWallet | DuskConnectLikeApp
): connect is DuskConnectLikeApp {
  return "wallet" in connect && typeof connect.writeContract === "function";
}

async function submitWithApp(
  app: DuskConnectLikeApp,
  options: CreateDuskConnectL1ClientOptions,
  request: DuskL1TransactionRequest
): Promise<unknown> {
  if (request.kind !== "contract_call") {
    return app.wallet.sendTransaction(await toWalletRequest(request, options));
  }
  if (!request.contractId || !request.method) {
    throw sdkError("INVALID_OPERATION", "Dusk contract call requires contractId and method");
  }
  return app.writeContract({
    contract: options.resolveContract!(request.contractId),
    functionName: request.method,
    ...(request.args === undefined ? {} : { args: request.args }),
    privacy: options.privacy,
    ...gasAndDisplay(request),
  });
}

async function toWalletRequest(
  request: DuskL1TransactionRequest,
  options: CreateDuskConnectL1ClientOptions
): Promise<DuskConnectTransactionRequest> {
  switch (request.kind) {
    case "transfer": {
      if (!request.to || request.amountLux === undefined) {
        throw sdkError("INVALID_OPERATION", "Dusk transfer requires to and amountLux");
      }
      return {
        kind: "transfer",
        privacy: options.privacy,
        to: request.to,
        amount: request.amountLux.toString(),
        ...gasAndDisplay(request),
      };
    }
    case "contract_call": {
      if (!request.contractId || !request.method) {
        throw sdkError("INVALID_OPERATION", "Dusk contract call requires contractId and method");
      }
      const fnArgs = await options.encodeContractCall!({
        contractId: request.contractId,
        method: request.method,
        ...(request.args === undefined ? {} : { args: request.args }),
      });
      return {
        kind: "contract_call",
        privacy: options.privacy,
        contractId: request.contractId,
        fnName: request.method,
        fnArgs,
        ...gasAndDisplay(request),
      };
    }
    case "raw":
      throw sdkError("UNSUPPORTED", "Dusk Connect does not support raw SDK transactions");
  }
}

function gasAndDisplay(request: DuskL1TransactionRequest): Record<string, unknown> {
  if (request.gasLimit !== undefined && request.gasPriceLux === undefined) {
    throw sdkError("INVALID_OPERATION", "Dusk gas limit requires a gas price");
  }
  return withoutUndefined({
    gas:
      request.gasLimit === undefined
        ? undefined
        : { limit: request.gasLimit.toString(), price: request.gasPriceLux!.toString() },
    display: request.metadata,
  });
}

function resolveReadContract(
  app: DuskConnectLikeApp | undefined,
  options: CreateDuskConnectL1ClientOptions
): DuskL1ContractReader["readContract"] | undefined {
  if (options.readContract) return options.readContract;
  if (!app?.readContract || !options.resolveContract) return undefined;
  return (request) =>
    app.readContract!({
      contract: options.resolveContract!(request.contractId),
      functionName: request.method,
      ...(request.args === undefined ? {} : { args: request.args }),
    });
}

function requirePrivacy(privacy: DuskConnectPrivacy): void {
  if (privacy !== "public" && privacy !== "shielded") {
    throw sdkError("INVALID_OPERATION", 'Dusk Connect privacy must be "public" or "shielded"');
  }
}

function withoutUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function normalizeSubmittedTransaction(raw: unknown): DuskL1SubmittedTransaction {
  if (typeof raw === "string" && raw.length > 0) {
    return { transactionHash: raw, raw };
  }

  if (raw && typeof raw === "object") {
    const value = raw as Record<string, unknown>;
    const hash = value.hash ?? value.txHash ?? value.transactionHash;
    if (typeof hash === "string" && hash.length > 0) {
      return { transactionHash: hash, raw };
    }
  }

  throw sdkError("CLIENT_ERROR", "Dusk wallet did not return a transaction hash", raw);
}

function normalizeGasPrice(raw: unknown): bigint {
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number" && Number.isSafeInteger(raw)) return BigInt(raw);
  if (typeof raw === "string" && /^\d+$/u.test(raw)) return BigInt(raw);
  if (raw && typeof raw === "object") {
    return normalizeGasPrice((raw as Record<string, unknown>).average);
  }
  throw sdkError("CLIENT_ERROR", "Dusk wallet did not return an average gas price", raw);
}

function hasWaitMethod(raw: unknown): raw is { wait(options?: unknown): Promise<unknown> } {
  return Boolean(
    raw && typeof raw === "object" && typeof (raw as { wait?: unknown }).wait === "function"
  );
}

async function waitOnHandle(
  handle: unknown,
  options?: WaitForDuskTransactionOptions
): Promise<unknown> {
  return (handle as {
    wait(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<unknown>;
  }).wait(connectWaitOptions(options));
}

function connectWaitOptions(
  options?: WaitForDuskTransactionOptions
): { timeoutMs?: number; signal?: AbortSignal } | undefined {
  if (!options) return undefined;
  return withoutUndefined({
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  }) as { timeoutMs?: number; signal?: AbortSignal };
}

function normalizeReceipt(transactionHash: TransactionHash, raw: unknown): DuskL1TransactionReceipt {
  if (!raw || typeof raw !== "object") return { transactionHash, raw };
  const value = raw as Record<string, unknown>;
  const normalizedHash =
    typeof value.transactionHash === "string"
      ? value.transactionHash
      : typeof value.hash === "string"
        ? value.hash
        : transactionHash;
  const receipt: DuskL1TransactionReceipt = {
    transactionHash: normalizedHash,
    raw,
  };
  const blockHeight = normalizeOptionalBigint(value.blockHeight ?? value.height);
  if (blockHeight !== undefined) receipt.blockHeight = blockHeight;
  if (typeof value.finalized === "boolean") receipt.finalized = value.finalized;
  if (typeof value.success === "boolean") receipt.success = value.success;
  if (value.status === "executed") receipt.success = true;
  if (value.status === "failed") receipt.success = false;
  return receipt;
}

function normalizeOptionalBigint(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/u.test(value)) return BigInt(value);
  return undefined;
}
