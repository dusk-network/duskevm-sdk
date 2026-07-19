import type { Hex } from "../types.js";

/** Deposit target discriminators supported by the diagnostic codec. */
export type DepositTargetKind = "native" | "contract" | "bls" | "evm" | "raw";

/** Typed target carried by a Dusk deposit envelope. */
export type DuskDepositTarget = {
  kind: DepositTargetKind;
  value: string;
};

/** Decoded version-one Dusk deposit envelope. */
export type DuskDepositEnvelope = {
  version: 1;
  target: DuskDepositTarget;
  payload: Hex;
};

/** Result of non-throwing deposit-envelope inspection. */
export type DepositEnvelopeDiagnostic =
  | {
      ok: true;
      rawHex: Hex;
      depositEnvelope: DuskDepositEnvelope;
      warnings: string[];
    }
  | {
      ok: false;
      rawHex: Hex;
      errors: string[];
      warnings: string[];
    };

/** Input used to encode a deposit envelope. */
export type EncodeDuskDepositEnvelopeOptions = {
  target: DuskDepositTarget;
  payload?: Hex | Uint8Array | string;
};
