import { defineChain } from "viem";
import type { DuskEvmChain } from "./types.js";

/** Inputs used to define a DuskEVM-compatible viem chain. */
export type DefineDuskEvmChainOptions = {
  id: number;
  name: string;
  rpcUrl: string;
  explorerUrl?: string;
};

/** Define a DuskEVM viem chain from deployment endpoints. */
export function defineDuskEvmChain(options: DefineDuskEvmChainOptions): DuskEvmChain {
  return defineChain({
    id: options.id,
    name: options.name,
    nativeCurrency: {
      decimals: 18,
      name: "DUSK",
      symbol: "DUSK",
    },
    rpcUrls: {
      default: {
        http: [options.rpcUrl],
      },
    },
    blockExplorers: options.explorerUrl
      ? {
          default: {
            name: "DuskEVM Explorer",
            url: options.explorerUrl,
          },
        }
      : undefined,
  });
}

/** Canonical DuskEVM mainnet chain definition. */
export const duskEvmMainnet: DuskEvmChain = defineDuskEvmChain({
  id: 744,
  name: "DuskEVM Mainnet",
  rpcUrl: "https://rpc.evm.dusk.network",
  explorerUrl: "https://explorer.evm.dusk.network",
});

/** Canonical DuskEVM testnet chain definition. */
export const duskEvmTestnet: DuskEvmChain = defineDuskEvmChain({
  id: 745,
  name: "DuskEVM Testnet",
  rpcUrl: "https://rpc.testnet.evm.dusk.network",
  explorerUrl: "https://explorer.testnet.evm.dusk.network",
});
