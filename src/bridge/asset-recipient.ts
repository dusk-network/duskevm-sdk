import { bls12_381 as bls12381 } from "@noble/curves/bls12-381";
import { bytesToHex, hexToBytes, keccak256, type Hex } from "viem";
import { sdkError } from "../errors.js";
import { duskL1WireFormats } from "../l1/dusk-contract-interface.js";
import type { EvmAddress } from "../types.js";

const assetFormat = duskL1WireFormats.bridgeAssetRecipientV1;
const nativeCreditFormat = duskL1WireFormats.nativeContractCreditV1;

/** Byte length of a compressed Dusk BLS public key. */
export const DUSK_COMPRESSED_BLS_PUBLIC_KEY_BYTES = 96;
/** Byte length of the raw BLS key encoded in a bridge recipient. */
export const DUSK_RAW_BLS_PUBLIC_KEY_BYTES: number = assetFormat.rawPublicKeyBytes;
/** Total byte length of a version-one external bridge recipient. */
export const DUSK_EXTERNAL_ASSET_RECIPIENT_BYTES: number =
  3 + DUSK_RAW_BLS_PUBLIC_KEY_BYTES;

const BLS12_381_FP_MODULUS = BigInt(
  "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab"
);
const BLS12_381_MONTGOMERY_R = (1n << 384n) % BLS12_381_FP_MODULUS;
const BLS12_381_MONTGOMERY_R_INVERSE = BigInt(
  "0x14fec701e8fb0ce9ed5e64273c4f538b1797ab1458a88de9343ea97914956dc87fe11274d898fafbf4d38259380b4820"
);
const FP_RAW_BYTES = 48;
const UINT64_MASK = (1n << 64n) - 1n;

/** Hexadecimal or byte-array representation of a Dusk public key. */
export type DuskPublicKeyBytes = Hex | Uint8Array;

/** Decoded native DUSK contract-credit recipient metadata. */
export type DuskNativeContractCredit = {
  targetContractId: Hex;
  payload: Hex;
};

/** Convert a canonical compressed Dusk BLS public key to raw affine coordinates. */
export function compressedDuskBlsPublicKeyToRaw(
  accountPublicKey: DuskPublicKeyBytes
): Uint8Array {
  const compressed = normalizeBytes(
    accountPublicKey,
    DUSK_COMPRESSED_BLS_PUBLIC_KEY_BYTES,
    "Dusk account public key"
  );

  let point;
  try {
    point = bls12381.G2.ProjectivePoint.fromHex(compressed);
    point.assertValidity();
    if (point.equals(bls12381.G2.ProjectivePoint.ZERO)) {
      throw new Error("point at infinity");
    }
  } catch (error) {
    throw sdkError("INVALID_OPERATION", "Dusk account public key is not valid BLS12-381", error);
  }

  const { x, y } = point.toAffine();
  const raw = new Uint8Array(DUSK_RAW_BLS_PUBLIC_KEY_BYTES);
  let offset = 0;

  for (const part of [x.c0, x.c1, y.c0, y.c1]) {
    raw.set(encodeFpMontgomeryRaw(part), offset);
    offset += 48;
  }
  raw[DUSK_RAW_BLS_PUBLIC_KEY_BYTES - 1] = 0;
  return raw;
}

/** Encode an external Dusk account as canonical bridge recipient metadata. */
export function encodeDuskExternalAssetRecipient(
  accountPublicKey: DuskPublicKeyBytes
): Hex {
  const raw = compressedDuskBlsPublicKeyToRaw(accountPublicKey);
  return bytesToHex(
    concatBytes(
      Uint8Array.of(assetFormat.tag, assetFormat.version, assetFormat.externalKind),
      raw
    )
  );
}

/** Encode a Dusk contract identifier as canonical asset-recipient metadata. */
export function encodeDuskContractAssetRecipient(contractId: Hex): Hex {
  const id = normalizeContractId(contractId, assetFormat.contractIdBytes);
  return bytesToHex(
    concatBytes(
      Uint8Array.of(assetFormat.tag, assetFormat.version, assetFormat.contractKind),
      id
    )
  );
}

/** Encode a Dusk contract identifier for a native-token contract credit. */
export function encodeDuskNativeContractCredit(
  contractId: Hex,
  payload: Hex = "0x"
): Hex {
  const id = normalizeContractId(contractId, nativeCreditFormat.contractIdBytes);
  const payloadBytes = normalizeHex(payload, "Native contract-credit payload");
  return bytesToHex(
    concatBytes(Uint8Array.of(nativeCreditFormat.tag, nativeCreditFormat.version), id, payloadBytes)
  );
}

/** Decode canonical native-token contract-credit metadata. */
export function decodeDuskNativeContractCredit(extraData: Hex): DuskNativeContractCredit {
  const bytes = hexToBytes(validateDuskNativeContractCredit(extraData));
  const targetStart = 2;
  const payloadStart = targetStart + nativeCreditFormat.contractIdBytes;
  return {
    targetContractId: bytesToHex(bytes.subarray(targetStart, payloadStart)),
    payload: bytesToHex(bytes.subarray(payloadStart)),
  };
}

/** Return whether metadata uses the native contract-credit discriminator. */
export function isDuskNativeContractCredit(extraData: Hex): boolean {
  const bytes = hexToBytes(extraData);
  return bytes[0] === nativeCreditFormat.tag;
}

/** Return the canonical 20-byte EVM address of a full Dusk contract identifier. */
export function duskContractIdToEvmAddress(contractId: Hex): EvmAddress {
  const id = bytesToHex(normalizeContractId(contractId, nativeCreditFormat.contractIdBytes));
  const hash = keccak256(id);
  return `0x${hash.slice(-40)}` as EvmAddress;
}

/** Validate and normalize a raw Dusk BLS public key. */
export function validateRawDuskBlsPublicKey(
  accountPublicKey: DuskPublicKeyBytes
): Uint8Array {
  const raw = normalizeBytes(
    accountPublicKey,
    DUSK_RAW_BLS_PUBLIC_KEY_BYTES,
    "Dusk raw account public key"
  );

  try {
    if (raw[DUSK_RAW_BLS_PUBLIC_KEY_BYTES - 1] !== 0) {
      throw new Error("identity flag is set");
    }
    const point = bls12381.G2.ProjectivePoint.fromAffine({
      x: {
        c0: decodeFpMontgomeryRaw(raw, 0),
        c1: decodeFpMontgomeryRaw(raw, FP_RAW_BYTES),
      },
      y: {
        c0: decodeFpMontgomeryRaw(raw, 2 * FP_RAW_BYTES),
        c1: decodeFpMontgomeryRaw(raw, 3 * FP_RAW_BYTES),
      },
    });
    point.assertValidity();
    if (point.equals(bls12381.G2.ProjectivePoint.ZERO)) {
      throw new Error("point at infinity");
    }
  } catch (error) {
    throw sdkError("INVALID_OPERATION", "Dusk raw account public key is not valid BLS12-381", error);
  }

  return raw;
}

/** Validate canonical external-account or contract asset-recipient metadata. */
export function validateDuskAssetRecipient(extraData: Hex): Hex {
  const bytes = normalizeHex(extraData, "Dusk asset recipient");
  if (bytes[0] !== assetFormat.tag || bytes[1] !== assetFormat.version) {
    throw sdkError("INVALID_OPERATION", "Dusk asset recipient has an unsupported tag or version");
  }

  if (bytes[2] === assetFormat.externalKind) {
    requireLength(bytes, DUSK_EXTERNAL_ASSET_RECIPIENT_BYTES, "Dusk external asset recipient");
    validateRawDuskBlsPublicKey(bytes.subarray(3));
  } else if (bytes[2] === assetFormat.contractKind) {
    requireLength(bytes, 3 + assetFormat.contractIdBytes, "Dusk contract asset recipient");
    requireNonZero(bytes.subarray(3), "Dusk contract asset recipient");
  } else {
    throw sdkError("INVALID_OPERATION", "Dusk asset recipient has an unsupported kind");
  }
  return bytesToHex(bytes);
}

/** Validate canonical native contract-credit metadata. */
export function validateDuskNativeContractCredit(extraData: Hex): Hex {
  const bytes = normalizeHex(extraData, "Dusk native contract credit");
  const headerLength = 2 + nativeCreditFormat.contractIdBytes;
  if (
    bytes[0] !== nativeCreditFormat.tag ||
    bytes[1] !== nativeCreditFormat.version ||
    bytes.length < headerLength
  ) {
    throw sdkError("INVALID_OPERATION", "Dusk native contract credit is malformed");
  }
  requireNonZero(bytes.subarray(2, headerLength), "Dusk native contract credit");
  return bytesToHex(bytes);
}

/** Validate recipient metadata accepted by native withdrawals. */
export function validateDuskNativeWithdrawalRecipient(extraData: Hex): Hex {
  const bytes = normalizeHex(extraData, "Dusk native withdrawal recipient");
  if (bytes[0] === nativeCreditFormat.tag) {
    return validateDuskNativeContractCredit(extraData);
  }

  const recipient = validateDuskAssetRecipient(extraData);
  if (bytes[2] !== assetFormat.externalKind) {
    throw sdkError(
      "INVALID_OPERATION",
      "Dusk native withdrawal recipient must be an external account or native contract credit"
    );
  }
  return recipient;
}

function encodeFpMontgomeryRaw(value: bigint): Uint8Array {
  let montgomery = (value * BLS12_381_MONTGOMERY_R) % BLS12_381_FP_MODULUS;
  const out = new Uint8Array(48);
  for (let limbIndex = 0; limbIndex < 6; limbIndex++) {
    let limb = montgomery & UINT64_MASK;
    for (let byteIndex = 0; byteIndex < 8; byteIndex++) {
      out[limbIndex * 8 + byteIndex] = Number(limb & 0xffn);
      limb >>= 8n;
    }
    montgomery >>= 64n;
  }
  return out;
}

function decodeFpMontgomeryRaw(value: Uint8Array, offset: number): bigint {
  let montgomery = 0n;
  for (let index = FP_RAW_BYTES - 1; index >= 0; index--) {
    montgomery = (montgomery << 8n) | BigInt(value[offset + index]!);
  }
  if (montgomery >= BLS12_381_FP_MODULUS) {
    throw new Error("field element is out of range");
  }
  return (montgomery * BLS12_381_MONTGOMERY_R_INVERSE) % BLS12_381_FP_MODULUS;
}

function normalizeBytes(value: DuskPublicKeyBytes, expected: number, name: string): Uint8Array {
  const bytes = typeof value === "string" ? normalizeHex(value, name) : Uint8Array.from(value);
  requireLength(bytes, expected, name);
  return bytes;
}

function normalizeHex(value: Hex, name: string): Uint8Array {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw sdkError("INVALID_OPERATION", `${name} must be 0x-prefixed byte hex`);
  }
  return hexToBytes(value);
}

function normalizeContractId(value: Hex, expected: number): Uint8Array {
  const bytes = normalizeHex(value, "Dusk contract id");
  requireLength(bytes, expected, "Dusk contract id");
  requireNonZero(bytes, "Dusk contract id");
  return bytes;
}

function requireLength(value: Uint8Array, expected: number, name: string): void {
  if (value.length !== expected) {
    throw sdkError("INVALID_OPERATION", `${name} must be ${expected} bytes`);
  }
}

function requireNonZero(value: Uint8Array, name: string): void {
  if (value.every((byte) => byte === 0)) {
    throw sdkError("INVALID_OPERATION", `${name} must not be zero`);
  }
}

function concatBytes(...values: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(values.reduce((length, value) => length + value.length, 0));
  let offset = 0;
  for (const value of values) {
    out.set(value, offset);
    offset += value.length;
  }
  return out;
}
