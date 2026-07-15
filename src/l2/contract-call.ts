import { encodeFunctionData, type Hex } from "viem";
import {
  decodeDuskContractCallEnvelope,
  DUSK_CONTRACT_CALL_TARGET,
  encodeDuskContractCallEnvelope,
  type DuskContractCallEnvelope,
} from "../envelope/index.js";
import { normalizeEvmAddress } from "../evm-address.js";
import type { EvmAddress } from "../types.js";
import { normalizeUint32 } from "../uint32.js";
import { L2_CROSS_DOMAIN_MESSENGER_ADDRESS } from "./bindings.js";
import { l2CrossDomainMessengerAbi } from "./op-abis.js";
import type { DuskEvmPreparedCall } from "./bindings.js";

/** Default L1 gas requested for a Dusk contract call. */
export const DEFAULT_DUSK_CONTRACT_CALL_MIN_GAS_LIMIT = 150_000;

/** Parameters for preparing a zero-value L2-to-Dusk contract call. */
export type PrepareDuskContractCallOptions = {
  targetContractId: Hex;
  payload?: Hex | Uint8Array;
  minGasLimit?: number;
  messengerAddress?: EvmAddress;
};

/** Persistable contract-call intent and its L2 Messenger transaction. */
export type PreparedDuskContractCall = {
  targetContractId: Hex;
  payload: Hex;
  minGasLimit: number;
  envelope: DuskContractCallEnvelope;
  envelopeHex: Hex;
  l2Transaction: DuskEvmPreparedCall;
};

/** Prepare a zero-value call to a Dusk contract through the OP Messenger. */
export function prepareDuskContractCall(
  options: PrepareDuskContractCallOptions
): PreparedDuskContractCall {
  const envelopeHex = encodeDuskContractCallEnvelope(options);
  const envelope = decodeDuskContractCallEnvelope(envelopeHex);
  const minGasLimit = normalizeUint32(
    options.minGasLimit ?? DEFAULT_DUSK_CONTRACT_CALL_MIN_GAS_LIMIT,
    "Dusk contract-call minGasLimit"
  );
  const messengerAddress = normalizeEvmAddress(
    options.messengerAddress ?? L2_CROSS_DOMAIN_MESSENGER_ADDRESS,
    "L2 cross-domain messenger"
  );

  return {
    targetContractId: envelope.targetContractId,
    payload: envelope.payload,
    minGasLimit,
    envelope,
    envelopeHex,
    l2Transaction: {
      to: messengerAddress,
      data: encodeFunctionData({
        abi: l2CrossDomainMessengerAbi,
        functionName: "sendMessage",
        args: [DUSK_CONTRACT_CALL_TARGET, envelopeHex, minGasLimit],
      }),
    },
  };
}
