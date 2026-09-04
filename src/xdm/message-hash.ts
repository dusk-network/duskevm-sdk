import { encodeFunctionData, keccak256, type Hex } from "viem";
import { l2CrossDomainMessengerAbi } from "../l2/index.js";
import type { EvmAddress } from "../types.js";

export type OpCrossDomainMessage = {
  nonce: bigint;
  sender: EvmAddress;
  target: EvmAddress;
  value: bigint;
  minGasLimit: bigint;
  message: Hex;
};

/** Hash canonical OP v1 relayMessage calldata, including its selector. */
export function hashOpCrossDomainMessage(message: OpCrossDomainMessage): Hex {
  return keccak256(
    encodeFunctionData({
      abi: l2CrossDomainMessengerAbi,
      functionName: "relayMessage",
      args: [
        message.nonce,
        message.sender,
        message.target,
        message.value,
        message.minGasLimit,
        message.message,
      ],
    })
  );
}
