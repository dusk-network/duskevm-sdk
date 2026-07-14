import type { Abi, Chain, EIP1193Provider, PublicClient, Transport } from "viem";

/** ABI shape accepted by DuskEVM viem helpers. */
export type DuskEvmAbi = Abi;

/** viem chain definition used by DuskEVM clients. */
export type DuskEvmChain = Chain;

/** EIP-1193 provider accepted by wallet transport adapters. */
export type DuskEvmEip1193Provider = EIP1193Provider;

/** viem transport used by DuskEVM public clients. */
export type DuskEvmTransport = Transport;

/** Public viem client configured for a DuskEVM chain. */
export type DuskEvmPublicClient = PublicClient<DuskEvmTransport, DuskEvmChain>;
