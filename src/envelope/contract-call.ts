import { bytesToHex, hexToBytes, type Hex } from "viem";
import { sdkError } from "../errors.js";
import { duskL1WireFormats } from "../l1/dusk-contract-interface.js";

const contractCallFormat = duskL1WireFormats.duskContractCallV1;

/** Fixed L1 Messenger target identifying a Dusk contract-call envelope. */
export const DUSK_CONTRACT_CALL_TARGET: `0x${string}` = contractCallFormat.target;

/** Fixed native receiver invoked for every generic application message. */
export const DUSK_CONTRACT_CALL_RECEIVER_ENTRYPOINT: "dusk_xdm_execute" =
  contractCallFormat.receiverEntrypoint;

/** First supported Dusk contract-call envelope version. */
export const DUSK_CONTRACT_CALL_ENVELOPE_VERSION: 1 = contractCallFormat.version;

/** Envelope kind for a zero-value call into a Dusk contract. */
export const DUSK_CONTRACT_CALL_KIND: 1 = contractCallFormat.kind;

/** Decoded L2-to-Dusk application-call envelope. */
export type DuskContractCallEnvelope = {
  version: typeof DUSK_CONTRACT_CALL_ENVELOPE_VERSION;
  kind: typeof DUSK_CONTRACT_CALL_KIND;
  targetContractId: Hex;
  payload: Hex;
};

/** Input used to encode an L2-to-Dusk application call. */
export type EncodeDuskContractCallEnvelopeOptions = {
  targetContractId: Hex;
  payload?: Hex | Uint8Array;
};

const FIXED_HEADER_BYTES = contractCallFormat.fixedHeaderBytes;
const CONTRACT_ID_BYTES = contractCallFormat.targetContractIdBytes;

/** Encode a zero-value application call for the fixed Messenger target. */
export function encodeDuskContractCallEnvelope(
  options: EncodeDuskContractCallEnvelopeOptions
): Hex {
  const targetContractId = normalizeContractId(options.targetContractId);
  const payload = normalizeBytes(options.payload ?? "0x", "Dusk contract-call payload");
  const output = new Uint8Array(FIXED_HEADER_BYTES + payload.length);
  output[0] = DUSK_CONTRACT_CALL_ENVELOPE_VERSION;
  output[1] = DUSK_CONTRACT_CALL_KIND;
  output.set(targetContractId, 2);
  output.set(payload, FIXED_HEADER_BYTES);
  return bytesToHex(output);
}

/** Decode and strictly validate a Dusk application-call envelope. */
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

  const targetContractId = bytes.slice(2, FIXED_HEADER_BYTES);
  requireNonZero(targetContractId, "Dusk contract-call target");
  return {
    version: DUSK_CONTRACT_CALL_ENVELOPE_VERSION,
    kind: DUSK_CONTRACT_CALL_KIND,
    targetContractId: bytesToHex(targetContractId),
    payload: bytesToHex(bytes.slice(FIXED_HEADER_BYTES)),
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
  if (!/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) {
    throw sdkError("INVALID_ENVELOPE", `${label} must be 0x-prefixed byte hex`);
  }
  return hexToBytes(value);
}

function requireNonZero(value: Uint8Array, label: string): void {
  if (value.every((byte) => byte === 0)) {
    throw sdkError("INVALID_ENVELOPE", `${label} must not be zero`);
  }
}
