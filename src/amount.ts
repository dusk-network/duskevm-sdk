import { sdkError } from "./errors.js";

/** Number of decimal places in one DUSK-denominated value. */
export const LUX_DECIMALS = 9;
/** Number of Lux in one DUSK. */
export const LUX_PER_DUSK = 1_000_000_000n;
/** Number of EVM wei represented by one Dusk Lux at the native bridge boundary. */
export const WEI_PER_LUX = 1_000_000_000n;
/** Largest native bridge amount representable by Dusk's u64 Lux transfer type. */
export const MAX_LUX_AMOUNT = (1n << 64n) - 1n;

/** Parse a non-negative decimal DUSK amount into integer Lux. */
export function parseDuskToLux(value: string): bigint {
  const input = value.trim();
  if (!/^\d+(\.\d+)?$/.test(input)) {
    throw sdkError("INVALID_AMOUNT", `Invalid DUSK amount: ${value}`);
  }

  const [wholeRaw = "0", fractionalRaw = ""] = input.split(".");
  if (fractionalRaw.length > LUX_DECIMALS) {
    throw sdkError("INVALID_AMOUNT", `DUSK amount has more than ${LUX_DECIMALS} decimals`);
  }

  const whole = BigInt(wholeRaw);
  const fractional = BigInt(fractionalRaw.padEnd(LUX_DECIMALS, "0") || "0");
  return whole * LUX_PER_DUSK + fractional;
}

/** Format an integer Lux amount as a decimal DUSK string. */
export function formatLuxToDusk(value: bigint | number | string): string {
  const lux = toLux(value);

  const whole = lux / LUX_PER_DUSK;
  const fractional = lux % LUX_PER_DUSK;
  if (fractional === 0n) return whole.toString();

  const fractionalText = fractional.toString().padStart(LUX_DECIMALS, "0").replace(/0+$/, "");
  return `${whole}.${fractionalText}`;
}

/** Normalize a non-negative integer Lux input to `bigint`. */
export function toLux(value: bigint | number | string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw sdkError("INVALID_AMOUNT", "Lux amount cannot be negative");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw sdkError("INVALID_AMOUNT", `Invalid Lux number: ${value}`);
    }
    return BigInt(value);
  }
  if (!/^\d+$/.test(value)) throw sdkError("INVALID_AMOUNT", `Invalid Lux amount: ${value}`);
  return BigInt(value);
}

/** Convert an EVM wei amount into an exact Dusk Lux amount for native contract credits. */
export function weiToLuxExact(value: bigint): bigint {
  if (value < 0n || value % WEI_PER_LUX !== 0n) {
    throw sdkError("INVALID_AMOUNT", "Native contract-credit value must convert to exact Lux");
  }
  const lux = value / WEI_PER_LUX;
  if (lux > MAX_LUX_AMOUNT) {
    throw sdkError("INVALID_AMOUNT", "Native contract-credit value exceeds the Dusk u64 Lux limit");
  }
  return lux;
}
