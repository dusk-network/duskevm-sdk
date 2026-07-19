import {
  encodeFunctionData,
  parseAbi,
  type EncodeFunctionDataParameters,
  type Hex,
} from "viem";
import type { EvmAddress } from "../types.js";
import { normalizeUint32 } from "../uint32.js";
import { normalizeUint256 } from "../uint256.js";
import { l2Erc721BridgeAbi, l2StandardBridgeAbi } from "./op-abis.js";
import type { DuskEvmAbi } from "./types.js";
export {
  l2CrossDomainMessengerAbi,
  l2Erc721BridgeAbi,
  l2StandardBridgeAbi,
  l2ToL1MessagePasserAbi,
  opContractsBedrockArtifactSource,
} from "./op-abis.js";

/** OP L2 cross-domain Messenger predeploy address. */
export const L2_CROSS_DOMAIN_MESSENGER_ADDRESS =
  "0x4200000000000000000000000000000000000007" as const;

/** OP L2 standard bridge predeploy address. */
export const L2_STANDARD_BRIDGE_ADDRESS =
  "0x4200000000000000000000000000000000000010" as const;
/** OP L2 ERC721 bridge predeploy address. */
export const L2_ERC721_BRIDGE_ADDRESS =
  "0x4200000000000000000000000000000000000014" as const;
/** OP L2-to-L1 message passer predeploy address. */
export const L2_TO_L1_MESSAGE_PASSER_ADDRESS =
  "0x4200000000000000000000000000000000000016" as const;
/** OP legacy token marker used for native-asset withdrawals. */
export const L2_LEGACY_ERC20_ETH_ADDRESS =
  "0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000" as const;

/** Minimal ERC20 ABI used by wallet integrations. */
export const erc20Abi: DuskEvmAbi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

/** Minimal ERC721 ABI used by wallet integrations. */
export const erc721Abi: DuskEvmAbi = parseAbi([
  "function approve(address to, uint256 tokenId)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
]);

/** Minimal read-contract client accepted by contract bindings. */
export type DuskEvmReadContractClient = {
  readContract(parameters: {
    address: EvmAddress;
    abi: DuskEvmAbi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
};

/** Encoded EVM transaction fields ready for wallet submission. */
export type DuskEvmPreparedCall = {
  to: EvmAddress;
  data: Hex;
  value?: bigint;
};

/** Small read-and-encode facade around one EVM contract. */
export type DuskEvmContractBinding<TAbi extends DuskEvmAbi = DuskEvmAbi> = {
  address: EvmAddress;
  abi: TAbi;
  read(functionName: string, args?: readonly unknown[]): Promise<unknown>;
  encode(functionName: string, args?: readonly unknown[]): Hex;
  call(functionName: string, args?: readonly unknown[], options?: { value?: bigint }): DuskEvmPreparedCall;
};

/** Create a typed contract binding backed by a read client. */
export function createDuskEvmContractBinding<TAbi extends DuskEvmAbi>(options: {
  client: DuskEvmReadContractClient;
  address: EvmAddress;
  abi: TAbi;
}): DuskEvmContractBinding<TAbi> {
  return {
    address: options.address,
    abi: options.abi,
    read(functionName, args) {
      const parameters: {
        address: EvmAddress;
        abi: DuskEvmAbi;
        functionName: string;
        args?: readonly unknown[];
      } = {
        address: options.address,
        abi: options.abi,
        functionName,
      };
      if (args !== undefined) parameters.args = args;
      return options.client.readContract(parameters);
    },
    encode(functionName, args) {
      return encodeContractCall(options.abi, functionName, args);
    },
    call(functionName, args, callOptions) {
      const call: DuskEvmPreparedCall = {
        to: options.address,
        data: encodeContractCall(options.abi, functionName, args),
      };
      if (callOptions?.value !== undefined) call.value = callOptions.value;
      return call;
    },
  };
}

function encodeContractCall(
  abi: DuskEvmAbi,
  functionName: string,
  args?: readonly unknown[]
): Hex {
  const parameters: EncodeFunctionDataParameters<DuskEvmAbi> = {
    abi,
    functionName,
  };
  if (args !== undefined) parameters.args = args;
  return encodeFunctionData(parameters);
}

/** Inputs for the raw OP standard-bridge withdrawal encoder. */
export type EncodeL2WithdrawalCallOptions = {
  bridgeAddress?: EvmAddress;
  l2Token: EvmAddress;
  amount: bigint;
  minGasLimit: number;
  extraData?: Hex;
  recipient?: EvmAddress;
};

/** Encode a raw OP standard-bridge withdrawal call. */
export function encodeL2WithdrawalCall(options: EncodeL2WithdrawalCallOptions): DuskEvmPreparedCall {
  const bridgeAddress = options.bridgeAddress ?? L2_STANDARD_BRIDGE_ADDRESS;
  const minGasLimit = normalizeUint32(options.minGasLimit, "L2 minGasLimit");
  const amount = normalizeUint256(options.amount, "L2 withdrawal amount");
  if (options.recipient) {
    return {
      to: bridgeAddress,
      data: encodeFunctionData({
        abi: l2StandardBridgeAbi,
        functionName: "withdrawTo",
        args: [
          options.l2Token,
          options.recipient,
          amount,
          minGasLimit,
          options.extraData ?? "0x",
        ],
      }),
    };
  }

  return {
    to: bridgeAddress,
    data: encodeFunctionData({
      abi: l2StandardBridgeAbi,
      functionName: "withdraw",
      args: [options.l2Token, amount, minGasLimit, options.extraData ?? "0x"],
    }),
  };
}

/** Inputs for a raw native OP standard-bridge withdrawal call. */
export type EncodeL2NativeWithdrawalCallOptions = {
  bridgeAddress?: EvmAddress;
  recipient: EvmAddress;
  amountWei: bigint;
  minGasLimit: number;
  extraData?: Hex;
};

/** Encode a raw native withdrawal call and matching transaction value. */
export function encodeL2NativeWithdrawalCall(
  options: EncodeL2NativeWithdrawalCallOptions
): DuskEvmPreparedCall {
  const bridgeAddress = options.bridgeAddress ?? L2_STANDARD_BRIDGE_ADDRESS;
  const amountWei = normalizeUint256(options.amountWei, "L2 native withdrawal amount");
  const minGasLimit = normalizeUint32(options.minGasLimit, "L2 minGasLimit");
  return {
    to: bridgeAddress,
    data: encodeFunctionData({
      abi: l2StandardBridgeAbi,
      functionName: "bridgeETHTo",
      args: [options.recipient, minGasLimit, options.extraData ?? "0x"],
    }),
    value: amountWei,
  };
}

/** Inputs for a raw DRC20 OP standard-bridge withdrawal call. */
export type EncodeL2Drc20WithdrawalCallOptions = {
  bridgeAddress?: EvmAddress;
  l2Token: EvmAddress;
  recipient: EvmAddress;
  amount: bigint;
  minGasLimit: number;
  extraData?: Hex;
};

/** Encode a raw DRC20 withdrawal call. */
export function encodeL2Drc20WithdrawalCall(
  options: EncodeL2Drc20WithdrawalCallOptions
): DuskEvmPreparedCall {
  const callOptions: EncodeL2WithdrawalCallOptions = {
    l2Token: options.l2Token,
    recipient: options.recipient,
    amount: normalizeUint256(options.amount, "L2 DRC20 withdrawal amount"),
    minGasLimit: options.minGasLimit,
  };
  if (options.bridgeAddress !== undefined) callOptions.bridgeAddress = options.bridgeAddress;
  if (options.extraData !== undefined) callOptions.extraData = options.extraData;
  return encodeL2WithdrawalCall(callOptions);
}

/** Inputs for a raw DRC721 OP bridge withdrawal call. */
export type EncodeL2Drc721WithdrawalCallOptions = {
  bridgeAddress?: EvmAddress;
  l1Token: EvmAddress;
  l2Token: EvmAddress;
  recipient: EvmAddress;
  tokenId: string | bigint;
  minGasLimit: number;
  extraData?: Hex;
};

/** Encode a raw DRC721 withdrawal call. */
export function encodeL2Drc721WithdrawalCall(
  options: EncodeL2Drc721WithdrawalCallOptions
): DuskEvmPreparedCall {
  const minGasLimit = normalizeUint32(options.minGasLimit, "L2 minGasLimit");
  const tokenId = normalizeUint256(options.tokenId, "L2 DRC721 tokenId");
  return {
    to: options.bridgeAddress ?? L2_ERC721_BRIDGE_ADDRESS,
    data: encodeFunctionData({
      abi: l2Erc721BridgeAbi,
      functionName: "bridgeERC721To",
      args: [
        options.l2Token,
        options.l1Token,
        options.recipient,
        tokenId,
        minGasLimit,
        options.extraData ?? "0x",
      ],
    }),
  };
}
