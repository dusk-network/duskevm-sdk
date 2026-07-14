import type { Hex } from "../types.js";

/** Delivery target discriminators supported by the diagnostic envelope codec. */
export type DeliveryTargetKind = "native" | "contract" | "bls" | "evm" | "raw";

/** Typed target carried by a Dusk delivery envelope. */
export type DuskDeliveryTarget = {
  kind: DeliveryTargetKind;
  value: string;
};

/** Decoded version-one Dusk delivery envelope. */
export type DuskDeliveryEnvelope = {
  version: 1;
  target: DuskDeliveryTarget;
  payload: Hex;
};

/** Result of non-throwing delivery-envelope inspection. */
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

/** Input used to encode a delivery envelope. */
export type EncodeDuskDeliveryEnvelopeOptions = {
  target: DuskDeliveryTarget;
  payload?: Hex | Uint8Array | string;
};
