import { sdkError } from "./errors.js";
import type { EvmAddress } from "./types.js";

export function normalizeEvmAddress(value: unknown, label: string): EvmAddress {
  if (typeof value !== "string" || !/^0[xX][0-9a-fA-F]{40}$/.test(value)) {
    throw sdkError("INVALID_OPERATION", `${label} must be a 20-byte 0x-prefixed hex address`);
  }
  return value.toLowerCase() as EvmAddress;
}
