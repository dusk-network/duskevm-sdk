import { toLux } from "../amount.js";
import type { DuskL1Client } from "./types.js";

/** Fallback gas price for ordinary Dusk L1 calls when explicitly requested. */
export const DEFAULT_DUSK_GAS_PRICE_LUX = 1n;
/** Reference deployment gas price; not used by bridge calls by default. */
export const DEFAULT_DUSK_DEPLOYMENT_GAS_PRICE_LUX = 2_000n;

/** Inputs used to resolve a Dusk L1 gas price. */
export type ResolveDuskGasPriceOptions = {
  client?: Pick<DuskL1Client, "getGasPriceLux">;
  gasPriceLux?: bigint | number | string;
  deployment?: boolean;
};

/** Resolve an explicit, client-provided, or fallback Dusk L1 gas price. */
export async function resolveDuskGasPriceLux(options: ResolveDuskGasPriceOptions = {}): Promise<bigint> {
  if (options.gasPriceLux !== undefined) return toLux(options.gasPriceLux);

  const fromClient = await options.client?.getGasPriceLux?.();
  if (fromClient !== undefined) return fromClient;

  return options.deployment ? DEFAULT_DUSK_DEPLOYMENT_GAS_PRICE_LUX : DEFAULT_DUSK_GAS_PRICE_LUX;
}

/** Calculate the minimum spendable Lux for value plus the transaction fee ceiling. */
export function minimumSpendableLux(options: {
  gasLimit: bigint | number | string;
  gasPriceLux: bigint | number | string;
  bufferLux?: bigint | number | string;
}): bigint {
  return toLux(options.gasLimit) * toLux(options.gasPriceLux) + toLux(options.bufferLux ?? 0n);
}
