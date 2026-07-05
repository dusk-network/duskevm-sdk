import {
  createPublicClient,
  custom,
  http,
  type Chain,
  type EIP1193Provider,
  type PublicClient,
  type Transport,
} from "viem";

export type CreateDuskEvmPublicClientOptions = {
  chain: Chain;
  rpcUrl?: string;
  transport?: Transport;
};

export function createDuskEvmPublicClient(
  options: CreateDuskEvmPublicClientOptions
): PublicClient<Transport, Chain> {
  return createPublicClient({
    chain: options.chain,
    transport: options.transport ?? http(options.rpcUrl),
  }) as PublicClient<Transport, Chain>;
}

export function transportFromEip1193Provider(provider: EIP1193Provider): Transport {
  return custom(provider);
}
