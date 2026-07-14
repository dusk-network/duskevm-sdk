/** A `0x`-prefixed hexadecimal value compatible with viem. */
export type Hex = `0x${string}`;

/** A Dusk account address in the representation accepted by the active wallet. */
export type DuskAddress = string;
/** A Dusk contract identifier accepted by Rusk wallet clients. */
export type DuskContractId = string;
/** A 32-byte DRC registry contract identifier. */
export type DrcRegistryContractId = Hex;
/** A `0x`-prefixed, 20-byte EVM address. */
export type EvmAddress = `0x${string}`;
/** An amount denominated in integer Lux. */
export type LuxAmount = bigint;
/** A transaction hash returned by a Dusk client. */
export type TransactionHash = string;

/** A value that may be returned directly or through a promise. */
export type MaybePromise<T> = T | Promise<T>;

/** A primitive value that can be serialized as JSON. */
export type JsonPrimitive = string | number | boolean | null;
/** A recursively JSON-serializable value. */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Options shared by operations that support cancellation. */
export type Abortable = {
  signal?: AbortSignal;
};
