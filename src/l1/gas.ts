import { toLux } from "../amount.js";
import type { DuskL1Client } from "./types.js";

export const DEFAULT_DUSK_GAS_PRICE_LUX = 1n;
export const DEFAULT_DUSK_DEPLOYMENT_GAS_PRICE_LUX = 2_000n;

export type ResolveDuskGasPriceOptions = {
  client?: Pick<DuskL1Client, "getGasPriceLux">;
  gasPriceLux?: bigint | number | string;
  deployment?: boolean;
};

export async function resolveDuskGasPriceLux(options: ResolveDuskGasPriceOptions = {}): Promise<bigint> {
  if (options.gasPriceLux !== undefined) return toLux(options.gasPriceLux);

  const fromClient = await options.client?.getGasPriceLux?.();
  if (fromClient !== undefined) return fromClient;

  return options.deployment ? DEFAULT_DUSK_DEPLOYMENT_GAS_PRICE_LUX : DEFAULT_DUSK_GAS_PRICE_LUX;
}

export function minimumSpendableLux(options: {
  gasLimit: bigint | number | string;
  gasPriceLux: bigint | number | string;
  bufferLux?: bigint | number | string;
}): bigint {
  return toLux(options.gasLimit) * toLux(options.gasPriceLux) + toLux(options.bufferLux ?? 0n);
}
