import type { Hex } from "viem";
import type { DuskDeliveryEnvelope } from "../envelope/index.js";
import type {
  DuskL1Client,
  DuskL1SubmittedTransaction,
  DuskL1TransactionBuilder,
  DuskL1TransactionRequest,
} from "../l1/index.js";
import type { BridgeOperationStatus } from "../status/index.js";
import type {
  Abortable,
  DrcRegistryContractId,
  DuskContractId,
  EvmAddress,
  JsonValue,
  LuxAmount,
  MaybePromise,
} from "../types.js";

export type BridgeDirection = "l1-to-l2" | "l2-to-l1";

export type BridgeAsset =
  | {
      kind: "native";
      amountLux: LuxAmount;
    }
  | {
      kind: "drc20";
      duskContractId: DrcRegistryContractId;
      l1Token: EvmAddress;
      l2Token: EvmAddress;
      amount: bigint;
    }
  | {
      kind: "drc721";
      duskContractId: DrcRegistryContractId;
      l1Token: EvmAddress;
      l2Token: EvmAddress;
      tokenId: string | bigint;
    };

export type BridgeOperationIntent = {
  id: string;
  direction: BridgeDirection;
  asset: BridgeAsset;
  envelope: DuskDeliveryEnvelope;
  envelopeHex: Hex;
  gas?: BridgeOperationGas;
  metadata: Record<string, JsonValue>;
};

export type BridgeOperationGas = {
  minGasLimit?: number;
  l1GasLimit?: bigint;
  gasPriceLux?: bigint;
};

export type PreparedBridgeOperation = BridgeOperationIntent & {
  l1Transaction?: DuskL1TransactionRequest;
};

export type BridgeDepositBaseParams = {
  l2Recipient: EvmAddress;
  minGasLimit?: number;
  l1GasLimit?: bigint;
  gasPriceLux?: bigint;
  payload?: Hex;
  metadata?: Record<string, JsonValue>;
};

export type NativeDepositParams = BridgeDepositBaseParams & {
  amountLux: LuxAmount;
};

export type Drc20DepositParams = BridgeDepositBaseParams & {
  duskContractId: DrcRegistryContractId;
  l1Token: EvmAddress;
  l2Token: EvmAddress;
  amount: bigint;
};

export type Drc721DepositParams = BridgeDepositBaseParams & {
  duskContractId: DrcRegistryContractId;
  l1Token: EvmAddress;
  l2Token: EvmAddress;
  tokenId: string | bigint;
};

export type BridgeTransactionBuilder = DuskL1TransactionBuilder<BridgeOperationIntent>;

export type BridgeContractsConfig = {
  l1StandardBridgeContractId?: DuskContractId;
  l1Erc721BridgeContractId?: DuskContractId;
};

export type BridgeGasConfig = {
  defaultMinGasLimit?: number;
  l1GasLimit?: bigint;
  gasPriceLux?: bigint;
};

export type CreateBridgeL1TransactionBuilderOptions = BridgeContractsConfig & BridgeGasConfig;

export type SubmittedBridgeOperation = PreparedBridgeOperation & {
  l1Transaction: DuskL1TransactionRequest;
  submittedTransaction: DuskL1SubmittedTransaction;
  status: BridgeOperationStatus<Record<string, JsonValue>>;
};

export type WaitForBridgeOperationStatusOptions = Abortable & {
  intervalMs?: number;
  timeoutMs?: number;
};

export type CreateBridgeClientOptions = {
  l1?: DuskL1Client;
  contracts?: BridgeContractsConfig;
  gas?: BridgeGasConfig;
  buildL1Transaction?: BridgeTransactionBuilder;
  observeOperationStatus?: (
    operation: PreparedBridgeOperation
  ) => MaybePromise<BridgeOperationStatus<Record<string, JsonValue>>>;
};
