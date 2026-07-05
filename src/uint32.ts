import { sdkError } from "./errors.js";

const MAX_UINT32 = 0xffff_ffff;

export function normalizeUint32(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UINT32) {
    throw sdkError("INVALID_OPERATION", `${label} must be a uint32`);
  }
  return value;
}
