import {
  createPublicClient,
  custom,
  http,
} from "viem";
import type {
  DuskEvmChain,
  DuskEvmEip1193Provider,
  DuskEvmPublicClient,
  DuskEvmTransport,
} from "./types.js";

/** Chain and transport inputs for a DuskEVM public client. */
export type CreateDuskEvmPublicClientOptions = {
  chain: DuskEvmChain;
  rpcUrl?: string;
  transport?: DuskEvmTransport;
};

/** Create a viem public client for a DuskEVM chain. */
export function createDuskEvmPublicClient(
  options: CreateDuskEvmPublicClientOptions
): DuskEvmPublicClient {
  return createPublicClient({
    chain: options.chain,
    transport: options.transport ?? http(options.rpcUrl),
  }) as DuskEvmPublicClient;
}

/** Wrap an injected EIP-1193 wallet provider as a viem transport. */
export function transportFromEip1193Provider(
  provider: DuskEvmEip1193Provider
): DuskEvmTransport {
  return custom(provider);
}
