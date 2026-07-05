import { sdkError } from "./errors.js";

const UINT256_BOUND = 1n << 256n;

export function normalizeUint256(value: string | bigint, label: string): bigint {
  let normalized: bigint | undefined;
  if (typeof value === "bigint") {
    normalized = value;
  } else if (/^0[xX][0-9a-fA-F]+$/.test(value) || /^\d+$/.test(value)) {
    normalized = BigInt(value);
  }
  if (normalized === undefined) {
    throw sdkError("INVALID_OPERATION", `${label} must be a uint256 value`);
  }
  if (normalized < 0n || normalized >= UINT256_BOUND) {
    throw sdkError("INVALID_OPERATION", `${label} does not fit uint256`);
  }
  return normalized;
}
