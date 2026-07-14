import { keccak256, stringToHex } from "viem";
import type { JsonValue } from "../types.js";

/** Create a deterministic operation identifier from JSON-serializable intent data. */
export function createBridgeOperationId(prefix: string, payload: JsonValue): string {
  return `${prefix}:${keccak256(stringToHex(JSON.stringify(payload)))}`;
}
