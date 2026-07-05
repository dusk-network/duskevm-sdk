import { sdkError } from "../errors.js";
import type { Hex } from "../types.js";
import type {
  DeliveryEnvelopeDiagnostic,
  DeliveryTargetKind,
  DuskDeliveryEnvelope,
  EncodeDuskDeliveryEnvelopeOptions,
} from "./types.js";

const MAGIC = new Uint8Array([0x44, 0x45, 0x56, 0x4d]);
const VERSION = 1;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;

const TARGET_TO_CODE: Record<DeliveryTargetKind, number> = {
  native: 1,
  contract: 2,
  bls: 3,
  evm: 4,
  raw: 255,
};

const CODE_TO_TARGET: Record<number, DeliveryTargetKind | undefined> = {
  1: "native",
  2: "contract",
  3: "bls",
  4: "evm",
  255: "raw",
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeDuskDeliveryEnvelope(options: EncodeDuskDeliveryEnvelopeOptions): Hex {
  const targetCode = TARGET_TO_CODE[options.target.kind];
  if (targetCode === undefined) {
    throw sdkError("INVALID_ENVELOPE", `Unsupported delivery target kind: ${options.target.kind}`);
  }

  const targetBytes = textEncoder.encode(options.target.value);
  assertHeaderLength("Delivery target", targetBytes.length, MAX_U16);

  const payloadBytes = bytesFromPayload(options.payload ?? "0x");
  assertHeaderLength("Delivery payload", payloadBytes.length, MAX_U32);
  const out = new Uint8Array(12 + targetBytes.length + payloadBytes.length);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  out[5] = targetCode;
  writeU16(out, 6, targetBytes.length);
  writeU32(out, 8, payloadBytes.length);
  out.set(targetBytes, 12);
  out.set(payloadBytes, 12 + targetBytes.length);

  return bytesToHex(out);
}

export function decodeDuskDeliveryEnvelope(input: Hex | Uint8Array): DuskDeliveryEnvelope {
  const diagnostic = inspectDuskDeliveryEnvelope(input);
  if (!diagnostic.ok) {
    throw sdkError("INVALID_ENVELOPE", diagnostic.errors.join("; "));
  }
  return diagnostic.envelope;
}

export function inspectDuskDeliveryEnvelope(input: Hex | Uint8Array): DeliveryEnvelopeDiagnostic {
  const raw = input instanceof Uint8Array ? input : hexToBytes(input);
  const rawHex = bytesToHex(raw);
  const warnings: string[] = [];
  const errors: string[] = [];

  if (raw.length < 12) {
    return { ok: false, rawHex, errors: ["Envelope is shorter than the 12-byte header"], warnings };
  }

  if (!hasMagic(raw)) {
    return { ok: false, rawHex, errors: ["Envelope magic mismatch"], warnings };
  }

  const version = raw[4];
  if (version !== VERSION) errors.push(`Unsupported delivery envelope version: ${String(version)}`);

  const targetKind = CODE_TO_TARGET[raw[5] ?? -1];
  if (!targetKind) errors.push(`Unsupported delivery target code: ${String(raw[5])}`);

  const targetLength = readU16(raw, 6);
  const payloadLength = readU32(raw, 8);
  const expectedLength = 12 + targetLength + payloadLength;
  if (raw.length !== expectedLength) {
    errors.push(`Envelope length mismatch: expected ${expectedLength} bytes, got ${raw.length}`);
  }

  if (errors.length > 0 || !targetKind) {
    return { ok: false, rawHex, errors, warnings };
  }

  const targetStart = 12;
  const targetEnd = targetStart + targetLength;
  const payloadEnd = targetEnd + payloadLength;
  const target = textDecoder.decode(raw.slice(targetStart, targetEnd));
  const payload = bytesToHex(raw.slice(targetEnd, payloadEnd));

  if (target.length === 0) warnings.push("Delivery target is empty");

  return {
    ok: true,
    rawHex,
    envelope: {
      version: VERSION,
      target: {
        kind: targetKind,
        value: target,
      },
      payload,
    },
    warnings,
  };
}

function bytesFromPayload(payload: Hex | Uint8Array | string): Uint8Array {
  if (payload instanceof Uint8Array) return payload;
  if (isHex(payload)) return hexToBytes(payload);
  return textEncoder.encode(payload);
}

function assertHeaderLength(label: string, length: number, max: number): void {
  if (length > max) throw sdkError("INVALID_ENVELOPE", `${label} is too large`);
}

function hasMagic(bytes: Uint8Array): boolean {
  return MAGIC.every((byte, index) => bytes[index] === byte);
}

function isHex(value: string): value is Hex {
  return /^0x([0-9a-fA-F]{2})*$/.test(value);
}

function hexToBytes(hex: Hex): Uint8Array {
  if (!isHex(hex)) throw sdkError("INVALID_ENVELOPE", `Invalid hex payload: ${hex}`);
  const out = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function writeU16(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >> 8) & 0xff;
  out[offset + 1] = value & 0xff;
}

function writeU32(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  );
}
