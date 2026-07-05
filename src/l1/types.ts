import type { Abortable, JsonValue, LuxAmount, MaybePromise, TransactionHash } from "../types.js";

export type DuskTransactionKind = "transfer" | "contract_call" | "raw";

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

export type DuskL1SubmittedTransaction = {
  transactionHash: TransactionHash;
  raw?: unknown;
};

export type DuskL1TransactionReceipt = {
  transactionHash: TransactionHash;
  blockHeight?: bigint;
  finalized?: boolean;
  success?: boolean;
  raw?: unknown;
};

export type WaitForDuskTransactionOptions = Abortable & {
  timeoutMs?: number;
  pollIntervalMs?: number;
};

export type DuskL1Client = {
  submitTransaction(request: DuskL1TransactionRequest): Promise<DuskL1SubmittedTransaction>;
  getGasPriceLux?(): Promise<bigint | undefined>;
  waitForTransaction?(
    transactionHash: TransactionHash,
    options?: WaitForDuskTransactionOptions
  ): Promise<DuskL1TransactionReceipt>;
};

export type DuskL1TransactionBuilder<TOperation> = (
  operation: TOperation
) => MaybePromise<DuskL1TransactionRequest>;
