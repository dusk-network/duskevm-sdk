import { decodeDuskDeliveryEnvelope, encodeDuskDeliveryEnvelope } from "../envelope/index.js";
import { sdkError } from "../errors.js";
import type { DuskL1SubmittedTransaction } from "../l1/index.js";
import type { BridgeOperationStatus } from "../status/index.js";
import type { EvmAddress, JsonValue } from "../types.js";
import { keccak256, stringToHex } from "viem";
import type {
  CreateBridgeClientOptions,
  Drc20DepositParams,
  Drc721DepositParams,
  NativeDepositParams,
  PreparedBridgeOperation,
} from "./types.js";

export type BridgeClient = {
  prepareNativeDeposit(params: NativeDepositParams): PreparedBridgeOperation;
  prepareDrc20Deposit(params: Drc20DepositParams): PreparedBridgeOperation;
  prepareDrc721Deposit(params: Drc721DepositParams): PreparedBridgeOperation;
  submitPreparedOperation(operation: PreparedBridgeOperation): Promise<DuskL1SubmittedTransaction>;
  observeOperationStatus?(
    operation: PreparedBridgeOperation
  ): Promise<BridgeOperationStatus<Record<string, JsonValue>>>;
};

export function createBridgeClient(options: CreateBridgeClientOptions = {}): BridgeClient {
  const bridge: BridgeClient = {
    prepareNativeDeposit(params) {
      return prepareDeposit({
        asset: { kind: "native", amountLux: params.amountLux },
        l2Recipient: params.l2Recipient,
        payload: params.payload,
        metadata: params.metadata,
      });
    },
    prepareDrc20Deposit(params) {
      return prepareDeposit({
        asset: {
          kind: "drc20",
          contractId: params.contractId,
          amount: params.amount,
        },
        l2Recipient: params.l2Recipient,
        payload: params.payload,
        metadata: params.metadata,
      });
    },
    prepareDrc721Deposit(params) {
      return prepareDeposit({
        asset: {
          kind: "drc721",
          contractId: params.contractId,
          tokenId: params.tokenId,
        },
        l2Recipient: params.l2Recipient,
        payload: params.payload,
        metadata: params.metadata,
      });
    },
    async submitPreparedOperation(operation) {
      if (!options.l1) throw sdkError("UNSUPPORTED", "No Dusk L1 client configured");

      const l1Transaction =
        operation.l1Transaction ?? (await options.buildL1Transaction?.(operation));
      if (!l1Transaction) {
        throw sdkError("UNSUPPORTED", "No L1 transaction builder configured for bridge operation");
      }

      return options.l1.submitTransaction(l1Transaction);
    },
  };

  if (options.observeOperationStatus) {
    bridge.observeOperationStatus = async (operation) => options.observeOperationStatus!(operation);
  }

  return bridge;
}

type DepositInput = {
  asset: PreparedBridgeOperation["asset"];
  l2Recipient: EvmAddress;
  payload?: NativeDepositParams["payload"] | undefined;
  metadata?: NativeDepositParams["metadata"] | undefined;
};

function prepareDeposit(input: DepositInput): PreparedBridgeOperation {
  const envelopeHex = encodeDuskDeliveryEnvelope({
    target: {
      kind: "evm",
      value: input.l2Recipient,
    },
    payload: input.payload ?? "0x",
  });

  return {
    id: operationId("deposit", input.asset, input.l2Recipient, envelopeHex),
    direction: "l1-to-l2",
    asset: input.asset,
    envelopeHex,
    envelope: decodeDuskDeliveryEnvelope(envelopeHex),
    metadata: {
      ...(input.metadata ?? {}),
      l2Recipient: input.l2Recipient,
    },
  };
}

function operationId(
  prefix: string,
  asset: PreparedBridgeOperation["asset"],
  recipient: string,
  envelopeHex: `0x${string}`
): string {
  return `${prefix}:${keccak256(
    stringToHex(JSON.stringify(operationIdPayload(prefix, asset, recipient, envelopeHex)))
  )}`;
}

function operationIdPayload(
  prefix: string,
  asset: PreparedBridgeOperation["asset"],
  recipient: string,
  envelopeHex: `0x${string}`
): JsonValue {
  const base = {
    envelopeHex,
    prefix,
    recipient: recipient.toLowerCase(),
  };

  switch (asset.kind) {
    case "native":
      return {
        ...base,
        asset: {
          kind: asset.kind,
          amountLux: asset.amountLux.toString(),
        },
      };
    case "drc20":
      return {
        ...base,
        asset: {
          kind: asset.kind,
          contractId: asset.contractId,
          amount: asset.amount.toString(),
        },
      };
    case "drc721":
      return {
        ...base,
        asset: {
          kind: asset.kind,
          contractId: asset.contractId,
          tokenId: asset.tokenId.toString(),
        },
      };
  }
}
