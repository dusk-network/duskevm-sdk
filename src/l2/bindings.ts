import {
  encodeFunctionData,
  parseAbi,
  type Abi,
  type EncodeFunctionDataParameters,
  type Hex,
} from "viem";
import type { EvmAddress } from "../types.js";
import { normalizeUint32 } from "../uint32.js";

export const L2_STANDARD_BRIDGE_ADDRESS =
  "0x4200000000000000000000000000000000000010" as const;
export const L2_TO_L1_MESSAGE_PASSER_ADDRESS =
  "0x4200000000000000000000000000000000000016" as const;

export const erc20Abi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export const erc721Abi = parseAbi([
  "function approve(address to, uint256 tokenId)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
]);

export const l2StandardBridgeAbi = parseAbi([
  "function withdraw(address l2Token, uint256 amount, uint32 minGasLimit, bytes extraData)",
  "function withdrawTo(address l2Token, address to, uint256 amount, uint32 minGasLimit, bytes extraData)",
  "event WithdrawalInitiated(address indexed l1Token, address indexed l2Token, address indexed from, address to, uint256 amount, bytes extraData)",
]);

export const l2ToL1MessagePasserAbi = parseAbi([
  "function initiateWithdrawal(address target, uint256 gasLimit, bytes data) payable",
  "event MessagePassed(uint256 indexed nonce, address indexed sender, address indexed target, uint256 value, uint256 gasLimit, bytes data, bytes32 withdrawalHash)",
]);

export type DuskEvmReadContractClient = {
  readContract(parameters: {
    address: EvmAddress;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
};

export type DuskEvmPreparedCall = {
  to: EvmAddress;
  data: Hex;
  value?: bigint;
};

export type DuskEvmContractBinding<TAbi extends Abi = Abi> = {
  address: EvmAddress;
  abi: TAbi;
  read(functionName: string, args?: readonly unknown[]): Promise<unknown>;
  encode(functionName: string, args?: readonly unknown[]): Hex;
  call(functionName: string, args?: readonly unknown[], options?: { value?: bigint }): DuskEvmPreparedCall;
};

export function createDuskEvmContractBinding<TAbi extends Abi>(options: {
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
        abi: Abi;
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

function encodeContractCall(abi: Abi, functionName: string, args?: readonly unknown[]): Hex {
  const parameters: EncodeFunctionDataParameters<Abi> = {
    abi,
    functionName,
  };
  if (args !== undefined) parameters.args = args;
  return encodeFunctionData(parameters);
}

export type EncodeL2WithdrawalCallOptions = {
  bridgeAddress?: EvmAddress;
  l2Token: EvmAddress;
  amount: bigint;
  minGasLimit: number;
  extraData?: Hex;
  recipient?: EvmAddress;
};

export function encodeL2WithdrawalCall(options: EncodeL2WithdrawalCallOptions): DuskEvmPreparedCall {
  const bridgeAddress = options.bridgeAddress ?? L2_STANDARD_BRIDGE_ADDRESS;
  const minGasLimit = normalizeUint32(options.minGasLimit, "L2 minGasLimit");
  if (options.recipient) {
    return {
      to: bridgeAddress,
      data: encodeFunctionData({
        abi: l2StandardBridgeAbi,
        functionName: "withdrawTo",
        args: [
          options.l2Token,
          options.recipient,
          options.amount,
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
      args: [options.l2Token, options.amount, minGasLimit, options.extraData ?? "0x"],
    }),
  };
}
