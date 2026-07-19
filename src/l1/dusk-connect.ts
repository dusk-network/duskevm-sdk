import { sdkError } from "../errors.js";
import type { TransactionHash } from "../types.js";
import type {
  DuskL1Client,
  DuskL1ContractReader,
  DuskL1SubmittedTransaction,
  DuskL1TransactionReceipt,
  DuskL1TransactionRequest,
  WaitForDuskTransactionOptions,
} from "./types.js";

/** Minimal Dusk Connect-compatible wallet API consumed by the SDK. */
export type DuskConnectLikeWallet = {
  sendTransaction(request: Record<string, unknown>): Promise<unknown>;
  getGasPrice?(options?: { maxTransactions?: number }): Promise<unknown>;
  waitForTxExecuted?(
    transactionHash: TransactionHash,
    options?: WaitForDuskTransactionOptions
  ): Promise<unknown>;
};

/** Options used to adapt a Dusk Connect-compatible wallet. */
export type CreateDuskConnectL1ClientOptions = {
  maxGasPriceTransactions?: number;
  readContract?: DuskL1ContractReader["readContract"];
};

/** Adapt a Dusk Connect-compatible wallet to the SDK's L1 client interface. */
export function createDuskConnectL1Client(
  wallet: DuskConnectLikeWallet,
  options: CreateDuskConnectL1ClientOptions = {}
): DuskL1Client {
  return {
    async submitTransaction(request) {
      const raw = await wallet.sendTransaction(toWalletRequest(request));
      return normalizeSubmittedTransaction(raw);
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
      if (!wallet.waitForTxExecuted) {
        throw sdkError("UNSUPPORTED", "The Dusk wallet does not expose waitForTxExecuted");
      }
      return normalizeReceipt(transactionHash, await wallet.waitForTxExecuted(transactionHash, waitOptions));
    },
    ...(options.readContract === undefined ? {} : { readContract: options.readContract }),
  };
}

function toWalletRequest(request: DuskL1TransactionRequest): Record<string, unknown> {
  const base = withoutUndefined({
    kind: request.kind,
    gasLimit: request.gasLimit?.toString(),
    gasPrice: request.gasPriceLux?.toString(),
    metadata: request.metadata,
  });

  switch (request.kind) {
    case "transfer":
      return withoutUndefined({
        ...base,
        to: request.to,
        amount: request.amountLux?.toString(),
      });
    case "contract_call":
      return withoutUndefined({
        ...base,
        contract: request.contractId,
        fn: request.method,
        args: request.args ?? null,
      });
    case "raw":
      return withoutUndefined({
        ...base,
        payload: request.payload ?? null,
      });
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
  if (typeof raw === "string" && /^\d+$/.test(raw)) return BigInt(raw);
  if (raw && typeof raw === "object") {
    const value = raw as Record<string, unknown>;
    return normalizeGasPrice(value.gasPrice ?? value.price ?? value.lux);
  }
  throw sdkError("CLIENT_ERROR", "Dusk wallet did not return a usable gas price", raw);
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
  return receipt;
}

function normalizeOptionalBigint(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return undefined;
}
