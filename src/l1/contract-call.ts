import { bytesToHex, hexToBytes, type Hex } from "viem";
import { sdkError } from "../errors.js";
import { normalizeEvmAddress } from "../evm-address.js";
import type { DuskContractId, EvmAddress } from "../types.js";
import { normalizeUint32 } from "../uint32.js";
import { duskL1ContractMethods } from "./dusk-contract-interface.js";
import type { DuskL1Client, DuskL1TransactionRequest } from "./types.js";
import {
  submitDuskL1Transaction,
  type DuskL1SubmitOptions,
  type SubmittedDuskL1Transaction,
} from "./wait.js";

/** Default L2 gas requested for a Dusk-to-DuskEVM application call. */
export const DEFAULT_DUSK_EVM_CONTRACT_CALL_MIN_GAS_LIMIT = 250_000;

/** Parameters for preparing a zero-value Dusk-to-DuskEVM application call. */
export type PrepareDuskEvmContractCallOptions = {
  messengerContractId: DuskContractId;
  target: EvmAddress;
  payload?: Hex | Uint8Array;
  minGasLimit?: number;
  gasLimit?: bigint;
  gasPriceLux?: bigint;
};

/** Persistable Dusk-to-DuskEVM intent and its Dusk Messenger request. */
export type PreparedDuskEvmContractCall = {
  messengerContractId: DuskContractId;
  target: EvmAddress;
  payload: Hex;
  minGasLimit: number;
  l1Transaction: DuskL1TransactionRequest;
};

/** Submitted Dusk-to-DuskEVM call and its normalized Dusk transaction. */
export type SubmittedDuskEvmContractCall = PreparedDuskEvmContractCall & {
  submission: SubmittedDuskL1Transaction;
};

/** Prepare a zero-value call to an EVM contract through the Dusk Messenger. */
export function prepareDuskEvmContractCall(
  options: PrepareDuskEvmContractCallOptions
): PreparedDuskEvmContractCall {
  const messengerContractId = requireMessengerContractId(options.messengerContractId);
  const target = normalizeEvmAddress(options.target, "DuskEVM contract-call target");
  const payload = normalizePayload(options.payload ?? "0x");
  const minGasLimit = normalizeUint32(
    options.minGasLimit ?? DEFAULT_DUSK_EVM_CONTRACT_CALL_MIN_GAS_LIMIT,
    "DuskEVM contract-call minGasLimit"
  );
  const l1Transaction: DuskL1TransactionRequest = {
    kind: "contract_call",
    contractId: messengerContractId,
    method: duskL1ContractMethods.l1CrossDomainMessenger.sendMessage.name,
    args: [target, payload, minGasLimit],
    metadata: {
      xdmDirection: "dusk-to-duskevm",
      target,
      minGasLimit,
    },
  };
  if (options.gasLimit !== undefined) l1Transaction.gasLimit = options.gasLimit;
  if (options.gasPriceLux !== undefined) l1Transaction.gasPriceLux = options.gasPriceLux;

  return {
    messengerContractId,
    target,
    payload,
    minGasLimit,
    l1Transaction,
  };
}

/** Prepare, submit, and optionally wait for a Dusk-to-DuskEVM call. */
export async function submitDuskEvmContractCall(
  client: DuskL1Client,
  options: PrepareDuskEvmContractCallOptions,
  submitOptions?: DuskL1SubmitOptions
): Promise<SubmittedDuskEvmContractCall> {
  const prepared = prepareDuskEvmContractCall(options);
  return {
    ...prepared,
    submission: await submitDuskL1Transaction(client, prepared.l1Transaction, submitOptions),
  };
}

function requireMessengerContractId(contractId: DuskContractId): DuskContractId {
  if (typeof contractId !== "string" || contractId.trim().length === 0) {
    throw sdkError("UNSUPPORTED", "L1 Cross Domain Messenger contract id is required");
  }
  return contractId;
}

function normalizePayload(payload: Hex | Uint8Array): Hex {
  if (payload instanceof Uint8Array) return bytesToHex(payload);
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(payload)) {
    throw sdkError(
      "INVALID_OPERATION",
      "DuskEVM contract-call payload must be 0x-prefixed byte hex"
    );
  }
  return bytesToHex(hexToBytes(payload));
}
