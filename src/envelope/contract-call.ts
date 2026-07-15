import { bytesToHex, hexToBytes, type Hex } from "viem";
import { sdkError } from "../errors.js";

/** Fixed L1 Messenger target identifying a Dusk contract-call envelope. */
export const DUSK_CONTRACT_CALL_TARGET =
  "0x6901e2c830a4e1ddf737f0cac91ed8e0694efde7" as const;

/** First supported Dusk contract-call envelope version. */
export const DUSK_CONTRACT_CALL_ENVELOPE_VERSION = 1 as const;

/** Envelope kind for a zero-value call into a Dusk contract. */
export const DUSK_CONTRACT_CALL_KIND = 1 as const;

/** Decoded L2-to-Dusk contract-call envelope. */
export type DuskContractCallEnvelope = {
  version: typeof DUSK_CONTRACT_CALL_ENVELOPE_VERSION;
  kind: typeof DUSK_CONTRACT_CALL_KIND;
  targetContractId: Hex;
  payload: Hex;
};

/** Input used to encode an L2-to-Dusk contract call. */
export type EncodeDuskContractCallEnvelopeOptions = {
  targetContractId: Hex;
  payload?: Hex | Uint8Array;
};

const HEADER_BYTES = 34;
const CONTRACT_ID_BYTES = 32;

/** Encode a zero-value Dusk contract call for the fixed Messenger target. */
export function encodeDuskContractCallEnvelope(
  options: EncodeDuskContractCallEnvelopeOptions
): Hex {
  const targetContractId = normalizeContractId(options.targetContractId);
  const payload = normalizeBytes(options.payload ?? "0x", "Dusk contract-call payload");
  const output = new Uint8Array(HEADER_BYTES + payload.length);
  output[0] = DUSK_CONTRACT_CALL_ENVELOPE_VERSION;
  output[1] = DUSK_CONTRACT_CALL_KIND;
  output.set(targetContractId, 2);
  output.set(payload, HEADER_BYTES);
  return bytesToHex(output);
}

/** Decode and strictly validate a Dusk contract-call envelope. */
export function decodeDuskContractCallEnvelope(
  input: Hex | Uint8Array
): DuskContractCallEnvelope {
  const bytes = normalizeBytes(input, "Dusk contract-call envelope");
  if (bytes.length < HEADER_BYTES) {
    throw sdkError(
      "INVALID_ENVELOPE",
      `Dusk contract-call envelope must be at least ${HEADER_BYTES} bytes`
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

  const targetContractId = bytes.slice(2, HEADER_BYTES);
  requireNonZero(targetContractId, "Dusk contract-call target");

  return {
    version: DUSK_CONTRACT_CALL_ENVELOPE_VERSION,
    kind: DUSK_CONTRACT_CALL_KIND,
    targetContractId: bytesToHex(targetContractId),
    payload: bytesToHex(bytes.slice(HEADER_BYTES)),
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
