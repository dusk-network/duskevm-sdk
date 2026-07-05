import { defineChain } from "viem";

export type DefineDuskEvmChainOptions = {
  id: number;
  name: string;
  rpcUrl: string;
  explorerUrl?: string;
};

export function defineDuskEvmChain(options: DefineDuskEvmChainOptions) {
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

export const duskEvmMainnet = defineDuskEvmChain({
  id: 744,
  name: "DuskEVM Mainnet",
  rpcUrl: "https://rpc.evm.dusk.network",
  explorerUrl: "https://explorer.evm.dusk.network",
});

export const duskEvmTestnet = defineDuskEvmChain({
  id: 745,
  name: "DuskEVM Testnet",
  rpcUrl: "https://rpc.testnet.evm.dusk.network",
  explorerUrl: "https://explorer.testnet.evm.dusk.network",
});
