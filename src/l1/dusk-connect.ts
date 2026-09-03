import { sdkError } from "../errors.js";
import type { MaybePromise, TransactionHash } from "../types.js";
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

/** Current Dusk Connect transaction request subset emitted by this adapter. */
export type DuskConnectTransactionRequest =
  | {
      kind: "transfer";
      privacy: DuskConnectPrivacy;
      to: string;
      amount: string;
      gas?: DuskConnectGas;
    }
  | {
      kind: "contract_call";
      privacy: DuskConnectPrivacy;
      contractId: string;
      fnName: string;
      fnArgs: DuskConnectByteLike;
      deposit?: string;
      gas?: DuskConnectGas;
      display?: unknown;
    };

/** Minimal current Dusk Connect wallet API consumed by the SDK. */
export type DuskConnectLikeWallet = {
  sendTransaction(request: DuskConnectTransactionRequest): Promise<unknown>;
  getGasPrice?(options?: { maxTransactions?: number }): Promise<unknown>;
};

/** Options used to adapt the current Dusk Connect wallet facade. */
export type CreateDuskConnectL1ClientOptions = {
  privacy: DuskConnectPrivacy;
  maxGasPriceTransactions?: number;
  /** Encode logical SDK arguments into the RKYV bytes expected by Dusk Connect. */
  encodeContractCall: (request: DuskL1ContractReadRequest) => MaybePromise<DuskConnectByteLike>;
  /** Optional decoded system-contract reader supplied by the host application. */
  readContract?: DuskL1ContractReader["readContract"];
  /** Optional receipt tracker supplied by the host application. */
  waitForTransaction?: (
    transactionHash: TransactionHash,
    options?: WaitForDuskTransactionOptions
  ) => Promise<unknown>;
};

/** Adapt the current Dusk Connect wallet facade to the SDK L1 client. */
export function createDuskConnectL1Client(
  wallet: DuskConnectLikeWallet,
  options: CreateDuskConnectL1ClientOptions
): DuskL1Client {
  requirePrivacy(options.privacy);

  return {
    async submitTransaction(request) {
      return normalizeSubmittedTransaction(
        await wallet.sendTransaction(await toWalletRequest(request, options))
      );
    },
    async getGasPriceLux() {
      if (!wallet.getGasPrice) return undefined;
      const gasOptions =
        options.maxGasPriceTransactions === undefined
          ? undefined
          : { maxTransactions: options.maxGasPriceTransactions };
      return normalizeGasPrice(await wallet.getGasPrice(gasOptions));
    },
    ...(options.waitForTransaction === undefined
      ? {}
      : {
          async waitForTransaction(
            transactionHash: TransactionHash,
            waitOptions?: WaitForDuskTransactionOptions
          ) {
            return normalizeReceipt(
              transactionHash,
              await options.waitForTransaction!(transactionHash, waitOptions)
            );
          },
        }),
    ...(options.readContract === undefined ? {} : { readContract: options.readContract }),
  };
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
        ...gasOverride(request),
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
        ...contractCallOverrides(request),
      };
    }
    case "raw":
      throw sdkError("UNSUPPORTED", "Dusk Connect does not support raw SDK transactions");
  }
}

function contractCallOverrides(request: DuskL1TransactionRequest): Record<string, unknown> {
  return withoutUndefined({
    deposit: request.amountLux?.toString(),
    ...gasOverride(request),
    display: request.metadata,
  });
}

function gasOverride(request: DuskL1TransactionRequest): Record<string, unknown> {
  if (request.gasLimit !== undefined && request.gasPriceLux === undefined) {
    throw sdkError("INVALID_OPERATION", "Dusk gas limit requires a gas price");
  }
  return withoutUndefined({
    gas:
      request.gasLimit === undefined
        ? undefined
        : { limit: request.gasLimit.toString(), price: request.gasPriceLux!.toString() },
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

  const explicitSuccess = typeof value.success === "boolean" ? value.success : undefined;
  const connectSuccess = connectReceiptSuccess(value.status, value.ok, raw);
  if (
    value.status !== undefined &&
    explicitSuccess !== undefined &&
    explicitSuccess !== connectSuccess
  ) {
    throw sdkError("CLIENT_ERROR", "Dusk Connect returned contradictory receipt fields", raw);
  }
  const success = value.status === undefined ? explicitSuccess : connectSuccess;
  if (success !== undefined) receipt.success = success;
  return receipt;
}

function connectReceiptSuccess(status: unknown, ok: unknown, raw: unknown): boolean | undefined {
  if (status === "timeout") {
    throw sdkError("TIMEOUT", "Timed out waiting for the Dusk transaction", raw);
  }
  if (status === "executed") {
    if (ok === true) return true;
    if (ok === false) return false;
    return undefined;
  }
  if (status === "failed") {
    if (ok === false) return false;
    throw sdkError("CLIENT_ERROR", "Dusk Connect returned an invalid failed receipt", raw);
  }
  return undefined;
}

function normalizeOptionalBigint(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/u.test(value)) return BigInt(value);
  return undefined;
}
