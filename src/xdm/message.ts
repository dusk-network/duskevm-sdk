import {
  decodeEventLog,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  toHex,
  type Hex,
} from "viem";
import { sdkError } from "../errors.js";
import { normalizeEvmAddress } from "../evm-address.js";
import {
  duskL1ContractMethods,
  type DuskL1Client,
  type DuskL1ContractReader,
  type DuskL1SubmitOptions,
  type DuskL1TransactionRequest,
  type SubmittedDuskL1Transaction,
} from "../l1/index.js";
import type {
  EvmReceiptLike,
  WithdrawalTransaction,
} from "../bridge/index.js";
import { submitDuskL1Transaction } from "../l1/index.js";
import {
  L2_CROSS_DOMAIN_MESSENGER_ADDRESS,
  l2CrossDomainMessengerAbi,
  type DuskEvmPreparedCall,
} from "../l2/index.js";
import type { EvmAddress, JsonValue } from "../types.js";

const duskMessengerMethods = duskL1ContractMethods.l1CrossDomainMessenger;

/** Canonical OP v1 cross-domain message carried by both DuskEVM directions. */
export type CrossDomainMessage = {
  nonce: bigint;
  sender: EvmAddress;
  target: EvmAddress;
  value: bigint;
  minGasLimit: bigint;
  message: Hex;
};

/** Delivery state recorded by a cross-domain Messenger. */
export type CrossDomainDeliveryState =
  | { state: "pending"; messageHash: Hex; replayable: false }
  | { state: "delivered"; messageHash: Hex; replayable: false }
  | { state: "delivery_failed"; messageHash: Hex; replayable: true };

/** Parse the L1 Messenger relay call nested in an OP withdrawal. */
export function parseCrossDomainMessageFromWithdrawal(
  withdrawal: Pick<WithdrawalTransaction, "data">
): CrossDomainMessage {
  let decoded: { functionName: string; args?: readonly unknown[] };
  try {
    decoded = decodeFunctionData({
      abi: l2CrossDomainMessengerAbi,
      data: withdrawal.data,
    }) as { functionName: string; args?: readonly unknown[] };
  } catch (error) {
    throw sdkError("INVALID_OPERATION", "Withdrawal does not contain a Messenger relayMessage call", error);
  }

  if (decoded.functionName !== "relayMessage" || !decoded.args) {
    throw sdkError("INVALID_OPERATION", "Withdrawal does not contain a Messenger relayMessage call");
  }
  const [nonce, sender, target, value, minGasLimit, message] = decoded.args as readonly [
    bigint,
    EvmAddress,
    EvmAddress,
    bigint,
    bigint,
    Hex,
  ];
  return normalizeCrossDomainMessage({ nonce, sender, target, value, minGasLimit, message });
}

/** Parse the single SentMessage event emitted by the specified Messenger. */
export function parseSentMessageReceipt(
  receipt: EvmReceiptLike,
  messengerAddress: EvmAddress = L2_CROSS_DOMAIN_MESSENGER_ADDRESS
): CrossDomainMessage {
  const expectedAddress = normalizeEvmAddress(
    messengerAddress,
    "cross-domain Messenger"
  ).toLowerCase();
  let found: CrossDomainMessage | undefined;

  for (const log of receipt.logs ?? []) {
    if (log.address?.toLowerCase() !== expectedAddress) continue;
    if (!log.data || !log.topics?.[0]) continue;

    try {
      const decoded = decodeEventLog({
        abi: l2CrossDomainMessengerAbi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
        strict: true,
      }) as { eventName: string; args: unknown };
      if (decoded.eventName !== "SentMessage") continue;
      if (found) {
        throw sdkError("INVALID_OPERATION", "Receipt contains more than one SentMessage event");
      }
      const args = decoded.args as {
        target: EvmAddress;
        sender: EvmAddress;
        message: Hex;
        messageNonce: bigint;
        gasLimit: bigint;
      };
      found = normalizeCrossDomainMessage({
        nonce: args.messageNonce,
        sender: args.sender,
        target: args.target,
        value: 0n,
        minGasLimit: args.gasLimit,
        message: args.message,
      });
    } catch (error) {
      if (isSdkError(error)) throw error;
    }
  }

  if (!found) throw sdkError("INVALID_OPERATION", "No SentMessage event found in receipt");
  return found;
}

/** Compute the message identity used by the native Dusk Messenger. */
export function hashDuskCrossDomainMessage(message: CrossDomainMessage): Hex {
  const normalized = normalizeCrossDomainMessage(message);
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes" },
      ],
      [
        normalized.nonce,
        normalized.sender,
        normalized.target,
        normalized.value,
        normalized.minGasLimit,
        normalized.message,
      ]
    )
  );
}

/** Compute the message identity used by the Solidity DuskEVM Messenger. */
export function hashDuskEvmCrossDomainMessage(message: CrossDomainMessage): Hex {
  const normalized = normalizeCrossDomainMessage(message);
  return keccak256(
    encodeFunctionData({
      abi: l2CrossDomainMessengerAbi,
      functionName: "relayMessage",
      args: [
        normalized.nonce,
        normalized.sender,
        normalized.target,
        normalized.value,
        normalized.minGasLimit,
        normalized.message,
      ],
    })
  );
}

/** Build the permissionless Dusk L1 retry for a previously failed L2 message. */
export function buildDuskMessageReplayTransaction(params: {
  messengerContractId: string;
  message: CrossDomainMessage;
  gasLimit?: bigint;
  gasPriceLux?: bigint;
  metadata?: Record<string, JsonValue>;
}): DuskL1TransactionRequest {
  if (!params.messengerContractId.trim()) {
    throw sdkError("INVALID_OPERATION", "L1 cross-domain Messenger contract id is required");
  }
  const message = normalizeCrossDomainMessage(params.message);
  return {
    kind: "contract_call",
    contractId: params.messengerContractId,
    method: duskMessengerMethods.relayMessage.name,
    args: [
      toHex(message.nonce, { size: 32 }),
      message.sender,
      message.target,
      toHex(message.value, { size: 32 }),
      toHex(message.minGasLimit, { size: 32 }),
      message.message,
    ],
    ...(params.gasLimit === undefined ? {} : { gasLimit: params.gasLimit }),
    ...(params.gasPriceLux === undefined ? {} : { gasPriceLux: params.gasPriceLux }),
    metadata: {
      ...(params.metadata ?? {}),
      xdmDirection: "duskevm-to-dusk",
      messageHash: hashDuskCrossDomainMessage(message),
      retry: true,
    },
  };
}

/** Build the permissionless DuskEVM retry for a failed Dusk L1 message. */
export function buildDuskEvmMessageReplayTransaction(
  message: CrossDomainMessage,
  messengerAddress: EvmAddress = L2_CROSS_DOMAIN_MESSENGER_ADDRESS
): DuskEvmPreparedCall {
  const normalized = normalizeCrossDomainMessage(message);
  return {
    to: normalizeEvmAddress(messengerAddress, "L2 cross-domain messenger"),
    data: encodeFunctionData({
      abi: l2CrossDomainMessengerAbi,
      functionName: "relayMessage",
      args: [
        normalized.nonce,
        normalized.sender,
        normalized.target,
        normalized.value,
        normalized.minGasLimit,
        normalized.message,
      ],
    }),
  };
}

/** Read delivery state from the native Dusk L1 Messenger. */
export async function readDuskMessageDeliveryState(params: {
  reader: DuskL1ContractReader;
  messengerContractId: string;
  message: CrossDomainMessage;
}): Promise<CrossDomainDeliveryState> {
  const messageHash = hashDuskCrossDomainMessage(params.message);
  const [successful, failed] = await Promise.all([
    params.reader.readContract({
      contractId: params.messengerContractId,
      method: duskMessengerMethods.successfulMessages.name,
      args: messageHash,
    }),
    params.reader.readContract({
      contractId: params.messengerContractId,
      method: duskMessengerMethods.failedMessages.name,
      args: messageHash,
    }),
  ]);
  return deliveryState(messageHash, normalizeBoolean(successful), normalizeBoolean(failed));
}

/** Build and submit a permissionless retry through the native Dusk Messenger. */
export async function submitDuskMessageReplayTransaction(
  client: DuskL1Client,
  params: Parameters<typeof buildDuskMessageReplayTransaction>[0],
  options?: DuskL1SubmitOptions
): Promise<SubmittedDuskL1Transaction> {
  return submitDuskL1Transaction(client, buildDuskMessageReplayTransaction(params), options);
}

/** Read delivery state from the L2 Messenger. */
export async function readDuskEvmMessageDeliveryState(params: {
  client: {
    readContract(parameters: {
      address: EvmAddress;
      abi: typeof l2CrossDomainMessengerAbi;
      functionName: "successfulMessages" | "failedMessages";
      args: readonly [Hex];
    }): Promise<unknown>;
  };
  message: CrossDomainMessage;
  messengerAddress?: EvmAddress;
}): Promise<CrossDomainDeliveryState> {
  const messageHash = hashDuskEvmCrossDomainMessage(params.message);
  const address = normalizeEvmAddress(
    params.messengerAddress ?? L2_CROSS_DOMAIN_MESSENGER_ADDRESS,
    "L2 cross-domain messenger"
  );
  const [successful, failed] = await Promise.all([
    params.client.readContract({
      address,
      abi: l2CrossDomainMessengerAbi,
      functionName: "successfulMessages",
      args: [messageHash],
    }),
    params.client.readContract({
      address,
      abi: l2CrossDomainMessengerAbi,
      functionName: "failedMessages",
      args: [messageHash],
    }),
  ]);
  return duskEvmDeliveryState(
    messageHash,
    normalizeBoolean(successful),
    normalizeBoolean(failed)
  );
}

/** Reduce OP L2 Messenger flags, where a successful replay retains failure history. */
export function duskEvmDeliveryState(
  messageHash: Hex,
  successful: boolean,
  failed: boolean
): CrossDomainDeliveryState {
  if (successful) return { state: "delivered", messageHash, replayable: false };
  if (failed) return { state: "delivery_failed", messageHash, replayable: true };
  return { state: "pending", messageHash, replayable: false };
}

/** Reduce native Dusk Messenger flags, which must never remain contradictory. */
export function deliveryState(
  messageHash: Hex,
  successful: boolean,
  failed: boolean
): CrossDomainDeliveryState {
  if (successful && failed) {
    throw sdkError("CLIENT_ERROR", "Messenger reports a message as both successful and failed");
  }
  if (successful) return { state: "delivered", messageHash, replayable: false };
  if (failed) return { state: "delivery_failed", messageHash, replayable: true };
  return { state: "pending", messageHash, replayable: false };
}

function normalizeCrossDomainMessage(message: CrossDomainMessage): CrossDomainMessage {
  if (message.nonce < 0n || message.value < 0n || message.minGasLimit < 0n) {
    throw sdkError("INVALID_OPERATION", "Cross-domain message integers cannot be negative");
  }
  if (!/^0x(?:[0-9a-fA-F]{2})*$/u.test(message.message)) {
    throw sdkError("INVALID_OPERATION", "Cross-domain message payload must be byte hex");
  }
  return {
    ...message,
    sender: normalizeEvmAddress(message.sender, "cross-domain message sender"),
    target: normalizeEvmAddress(message.target, "cross-domain message target"),
    message: message.message.toLowerCase() as Hex,
  };
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 0n || value === "0" || value === "0x0") return false;
  if (value === 1 || value === 1n || value === "1" || value === "0x1") return true;
  throw sdkError("CLIENT_ERROR", "Dusk contract reader returned a non-boolean Messenger flag", value);
}

function isSdkError(value: unknown): boolean {
  return value instanceof Error && "code" in value;
}
