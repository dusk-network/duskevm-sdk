import type { Hex } from "../types.js";

export type DeliveryTargetKind = "native" | "contract" | "bls" | "evm" | "raw";

export type DuskDeliveryTarget = {
  kind: DeliveryTargetKind;
  value: string;
};

export type DuskDeliveryEnvelope = {
  version: 1;
  target: DuskDeliveryTarget;
  payload: Hex;
};

export type DeliveryEnvelopeDiagnostic =
  | {
      ok: true;
      rawHex: Hex;
      envelope: DuskDeliveryEnvelope;
      warnings: string[];
    }
  | {
      ok: false;
      rawHex: Hex;
      errors: string[];
      warnings: string[];
    };

export type EncodeDuskDeliveryEnvelopeOptions = {
  target: DuskDeliveryTarget;
  payload?: Hex | Uint8Array | string;
};
