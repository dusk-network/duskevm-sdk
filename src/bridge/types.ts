import type { Hex } from "viem";
import type { DuskDeliveryEnvelope } from "../envelope/index.js";
import type { DuskL1Client, DuskL1TransactionBuilder, DuskL1TransactionRequest } from "../l1/index.js";
import type { BridgeOperationStatus } from "../status/index.js";
import type { EvmAddress, JsonValue, LuxAmount, MaybePromise } from "../types.js";

export type BridgeDirection = "l1-to-l2" | "l2-to-l1";

export type BridgeAsset =
  | {
      kind: "native";
      amountLux: LuxAmount;
    }
  | {
      kind: "drc20";
      contractId: string;
      amount: bigint;
    }
  | {
      kind: "drc721";
      contractId: string;
      tokenId: string | bigint;
    };

export type BridgeOperationIntent = {
  id: string;
  direction: BridgeDirection;
  asset: BridgeAsset;
  envelope: DuskDeliveryEnvelope;
  envelopeHex: Hex;
  metadata: Record<string, JsonValue>;
};

export type PreparedBridgeOperation = BridgeOperationIntent & {
  l1Transaction?: DuskL1TransactionRequest;
};

export type NativeDepositParams = {
  amountLux: LuxAmount;
  l2Recipient: EvmAddress;
  payload?: Hex;
  metadata?: Record<string, JsonValue>;
};

export type Drc20DepositParams = {
  contractId: string;
  amount: bigint;
  l2Recipient: EvmAddress;
  payload?: Hex;
  metadata?: Record<string, JsonValue>;
};

export type Drc721DepositParams = {
  contractId: string;
  tokenId: string | bigint;
  l2Recipient: EvmAddress;
  payload?: Hex;
  metadata?: Record<string, JsonValue>;
};

export type BridgeTransactionBuilder = DuskL1TransactionBuilder<BridgeOperationIntent>;

export type CreateBridgeClientOptions = {
  l1?: DuskL1Client;
  buildL1Transaction?: BridgeTransactionBuilder;
  observeOperationStatus?: (
    operation: PreparedBridgeOperation
  ) => MaybePromise<BridgeOperationStatus<Record<string, JsonValue>>>;
};
