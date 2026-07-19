import type { Abortable, JsonValue, LuxAmount, MaybePromise, TransactionHash } from "../types.js";

/** Dusk transaction request variants understood by SDK adapters. */
export type DuskTransactionKind = "transfer" | "contract_call" | "raw";

/** Wallet-neutral Dusk L1 transaction request. */
export type DuskL1TransactionRequest = {
  kind: DuskTransactionKind;
  to?: string;
  amountLux?: LuxAmount;
  contractId?: string;
  method?: string;
  args?: JsonValue;
  payload?: JsonValue;
  gasLimit?: bigint;
  gasPriceLux?: bigint;
  metadata?: Record<string, JsonValue>;
};

/** Transaction identity returned immediately after Dusk L1 submission. */
export type DuskL1SubmittedTransaction = {
  transactionHash: TransactionHash;
  raw?: unknown;
};

/** Normalized Dusk L1 transaction receipt. */
export type DuskL1TransactionReceipt = {
  transactionHash: TransactionHash;
  blockHeight?: bigint;
  finalized?: boolean;
  success?: boolean;
  raw?: unknown;
};

/** Read-only Dusk contract request understood by SDK query adapters. */
export type DuskL1ContractReadRequest = {
  contractId: string;
  method: string;
  args?: JsonValue;
};

/** Minimal read surface used for authoritative Dusk contract state. */
export type DuskL1ContractReader = {
  readContract(request: DuskL1ContractReadRequest): Promise<unknown>;
};

/** Cancellation and timing controls for receipt polling. */
export type WaitForDuskTransactionOptions = Abortable & {
  timeoutMs?: number;
  pollIntervalMs?: number;
};

/** Minimal Dusk L1 client contract required by SDK submission helpers. */
export type DuskL1Client = {
  submitTransaction(request: DuskL1TransactionRequest): Promise<DuskL1SubmittedTransaction>;
  getGasPriceLux?(): Promise<bigint | undefined>;
  waitForTransaction?(
    transactionHash: TransactionHash,
    options?: WaitForDuskTransactionOptions
  ): Promise<DuskL1TransactionReceipt>;
  readContract?(request: DuskL1ContractReadRequest): Promise<unknown>;
};

/** Function that maps an SDK operation to a Dusk transaction request. */
export type DuskL1TransactionBuilder<TOperation> = (
  operation: TOperation
) => MaybePromise<DuskL1TransactionRequest>;
