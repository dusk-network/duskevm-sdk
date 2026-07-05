import { createBridgeClient, type BridgeClient, type CreateBridgeClientOptions } from "./bridge/index.js";
import type { DuskL1Client } from "./l1/index.js";

export type DuskEvmSdkOptions<TL2Client = unknown> = CreateBridgeClientOptions & {
  l2?: TL2Client;
};

export type DuskEvmSdk<TL2Client = unknown> = {
  bridge: BridgeClient;
  l1?: DuskL1Client;
  l2?: TL2Client;
};

export function createDuskEvmSdk<TL2Client = unknown>(
  options: DuskEvmSdkOptions<TL2Client> = {}
): DuskEvmSdk<TL2Client> {
  const sdk: DuskEvmSdk<TL2Client> = {
    bridge: createBridgeClient(options),
  };

  if (options.l1) sdk.l1 = options.l1;
  if (options.l2) sdk.l2 = options.l2;

  return sdk;
}
