import type { Hex } from "viem";

export type { Hex };

export type DuskAddress = string;
export type DuskContractId = string;
export type EvmAddress = `0x${string}`;
export type LuxAmount = bigint;
export type TransactionHash = string;

export type MaybePromise<T> = T | Promise<T>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type Abortable = {
  signal?: AbortSignal;
};
