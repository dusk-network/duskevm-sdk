import { bytesToHex, hexToBytes, type Hex } from "viem";
import { sdkError } from "../errors.js";

/** Fixed L1 Messenger target identifying a Dusk contract-call envelope. */
export const DUSK_CONTRACT_CALL_TARGET =
  "0x6901e2c830a4e1ddf737f0cac91ed8e0694efde7" as const;

/** First supported Dusk contract-call envelope version. */
export const DUSK_CONTRACT_CALL_ENVELOPE_VERSION = 1 as const;

/** Envelope kind for a zero-value call into a Dusk contract. */
export const DUSK_CONTRACT_CALL_KIND = 1 as const;

/** Maximum Dusk entrypoint length accepted by the generic application route. */
export const MAX_DUSK_CONTRACT_CALL_ENTRYPOINT_BYTES = 64;

/** Decoded L2-to-Dusk direct contract-call envelope. */
export type DuskContractCallEnvelope = {
  version: typeof DUSK_CONTRACT_CALL_ENVELOPE_VERSION;
  kind: typeof DUSK_CONTRACT_CALL_KIND;
  targetContractId: Hex;
  entrypoint: string;
  fnArgs: Hex;
};

/** Input used to encode an L2-to-Dusk direct contract call. */
export type EncodeDuskContractCallEnvelopeOptions = {
  targetContractId: Hex;
  entrypoint: string;
  fnArgs?: Hex | Uint8Array;
};

const FIXED_HEADER_BYTES = 36;
const CONTRACT_ID_BYTES = 32;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

/** Encode a zero-value direct Dusk contract call for the fixed Messenger target. */
export function encodeDuskContractCallEnvelope(
  options: EncodeDuskContractCallEnvelopeOptions
): Hex {
  const targetContractId = normalizeContractId(options.targetContractId);
  const entrypoint = normalizeEntrypoint(options.entrypoint);
  const fnArgs = normalizeBytes(options.fnArgs ?? "0x", "Dusk contract-call fnArgs");
  const output = new Uint8Array(FIXED_HEADER_BYTES + entrypoint.length + fnArgs.length);
  output[0] = DUSK_CONTRACT_CALL_ENVELOPE_VERSION;
  output[1] = DUSK_CONTRACT_CALL_KIND;
  output.set(targetContractId, 2);
  new DataView(output.buffer).setUint16(34, entrypoint.length, false);
  output.set(entrypoint, FIXED_HEADER_BYTES);
  output.set(fnArgs, FIXED_HEADER_BYTES + entrypoint.length);
  return bytesToHex(output);
}

/** Decode and strictly validate a Dusk direct contract-call envelope. */
export function decodeDuskContractCallEnvelope(
  input: Hex | Uint8Array
): DuskContractCallEnvelope {
  const bytes = normalizeBytes(input, "Dusk contract-call envelope");
  if (bytes.length < FIXED_HEADER_BYTES) {
    throw sdkError(
      "INVALID_ENVELOPE",
      `Dusk contract-call envelope must be at least ${FIXED_HEADER_BYTES} bytes`
    );
  }
  if (bytes[0] !== DUSK_CONTRACT_CALL_ENVELOPE_VERSION) {
    throw sdkError(
      "INVALID_ENVELOPE",
      `Unsupported Dusk contract-call envelope version: ${String(bytes[0])}`
    );
  }
  if (bytes[1] !== DUSK_CONTRACT_CALL_KIND) {
    throw sdkError(
      "INVALID_ENVELOPE",
      `Unsupported Dusk contract-call kind: ${String(bytes[1])}`
    );
  }

  const targetContractId = bytes.slice(2, 34);
  requireNonZero(targetContractId, "Dusk contract-call target");

  const entrypointLength = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  ).getUint16(34, false);
  if (
    entrypointLength === 0 ||
    entrypointLength > MAX_DUSK_CONTRACT_CALL_ENTRYPOINT_BYTES
  ) {
    throw sdkError("INVALID_ENVELOPE", "Invalid Dusk contract-call entrypoint length");
  }
  const fnArgsOffset = FIXED_HEADER_BYTES + entrypointLength;
  if (bytes.length < fnArgsOffset) {
    throw sdkError("INVALID_ENVELOPE", "Truncated Dusk contract-call entrypoint");
  }

  let entrypoint: string;
  try {
    entrypoint = textDecoder.decode(bytes.slice(FIXED_HEADER_BYTES, fnArgsOffset));
  } catch {
    throw sdkError("INVALID_ENVELOPE", "Dusk contract-call entrypoint must be valid UTF-8");
  }
  normalizeEntrypoint(entrypoint);

  return {
    version: DUSK_CONTRACT_CALL_ENVELOPE_VERSION,
    kind: DUSK_CONTRACT_CALL_KIND,
    targetContractId: bytesToHex(targetContractId),
    entrypoint,
    fnArgs: bytesToHex(bytes.slice(fnArgsOffset)),
  };
}

function normalizeContractId(contractId: Hex): Uint8Array {
  const bytes = normalizeBytes(contractId, "Dusk contract-call target");
  if (bytes.length !== CONTRACT_ID_BYTES) {
    throw sdkError(
      "INVALID_ENVELOPE",
      `Dusk contract-call target must be ${CONTRACT_ID_BYTES} bytes`
    );
  }
  requireNonZero(bytes, "Dusk contract-call target");
  return bytes;
}

function normalizeEntrypoint(value: string): Uint8Array {
  if (value === "init" || value === "__constructor__") {
    throw sdkError("INVALID_ENVELOPE", "Dusk contract-call entrypoint is reserved");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw sdkError("INVALID_ENVELOPE", "Invalid Dusk contract-call entrypoint name");
  }

  const bytes = textEncoder.encode(value);
  if (bytes.length === 0 || bytes.length > MAX_DUSK_CONTRACT_CALL_ENTRYPOINT_BYTES) {
    throw sdkError("INVALID_ENVELOPE", "Invalid Dusk contract-call entrypoint length");
  }
  return bytes;
}

function normalizeBytes(value: Hex | Uint8Array, label: string): Uint8Array {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw sdkError("INVALID_ENVELOPE", `${label} must be 0x-prefixed byte hex`);
  }
  return hexToBytes(value);
}

function requireNonZero(value: Uint8Array, label: string): void {
  if (value.every((byte) => byte === 0)) {
    throw sdkError("INVALID_ENVELOPE", `${label} must not be zero`);
  }
}
