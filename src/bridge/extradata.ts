import { concatHex, numberToHex, type Hex } from "viem";
import { sdkError } from "../errors.js";
import type { DrcRegistryContractId } from "../types.js";

/** DRC20 registry payload discriminator. */
export const DRC20_REGISTRY_EXTRA_DATA_TAG = 0x10;
/** DRC721 registry payload discriminator. */
export const DRC721_REGISTRY_EXTRA_DATA_TAG = 0x11;

/** DRC registry variants supported by the bridge. */
export type DrcRegistryExtraDataKind = "drc20" | "drc721";

/** Input used to compose DRC registry bridge metadata. */
export type EncodeDrcRegistryExtraDataOptions = {
  kind: DrcRegistryExtraDataKind;
  duskContractId: DrcRegistryContractId;
  payload?: Hex;
};

/** Encode a DRC registry tag, contract identifier, and optional payload. */
export function encodeDrcRegistryExtraData(options: EncodeDrcRegistryExtraDataOptions): Hex {
  return concatHex([
    numberToHex(registryTag(options.kind), { size: 1 }),
    normalizeDuskContractIdHex(options.duskContractId),
    options.payload ?? "0x",
  ]);
}

/** Validate and normalize a 32-byte Dusk registry contract identifier. */
export function normalizeDuskContractIdHex(contractId: DrcRegistryContractId): Hex {
  if (!/^0[xX][0-9a-fA-F]{64}$/.test(contractId)) {
    throw sdkError("INVALID_OPERATION", "DRC registry contract id must be a 32-byte hex value");
  }
  return `0x${contractId.slice(2).toLowerCase()}`;
}

function registryTag(kind: DrcRegistryExtraDataKind): number {
  switch (kind) {
    case "drc20":
      return DRC20_REGISTRY_EXTRA_DATA_TAG;
    case "drc721":
      return DRC721_REGISTRY_EXTRA_DATA_TAG;
  }
}
