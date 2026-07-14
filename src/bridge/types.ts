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

/** Direction in which an asset moves through the DuskEVM bridge. */
export type BridgeDirection = "l1-to-l2" | "l2-to-l1";

/** Asset variants supported by bridge operation intents. */
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

/** Canonical, persistable description of a bridge operation. */
export type BridgeOperationIntent = {
  id: string;
  direction: BridgeDirection;
  asset: BridgeAsset;
  envelope: DuskDeliveryEnvelope;
  envelopeHex: Hex;
  gas?: BridgeOperationGas;
  metadata: Record<string, JsonValue>;
};

/** Optional gas overrides attached to an operation intent. */
export type BridgeOperationGas = {
  minGasLimit?: number;
  l1GasLimit?: bigint;
  gasPriceLux?: bigint;
};

/** Bridge intent with an optional prebuilt Dusk L1 transaction. */
export type PreparedBridgeOperation = BridgeOperationIntent & {
  l1Transaction?: DuskL1TransactionRequest;
};

/** Parameters shared by native and token deposits. */
export type BridgeDepositBaseParams = {
  l2Recipient: EvmAddress;
  minGasLimit?: number;
  l1GasLimit?: bigint;
  gasPriceLux?: bigint;
  payload?: Hex;
  metadata?: Record<string, JsonValue>;
};

/** Parameters for a native DUSK deposit to DuskEVM. */
export type NativeDepositParams = BridgeDepositBaseParams & {
  amountLux: LuxAmount;
};

/** Parameters for a DRC20 deposit to DuskEVM. */
export type Drc20DepositParams = BridgeDepositBaseParams & {
  duskContractId: DrcRegistryContractId;
  l1Token: EvmAddress;
  l2Token: EvmAddress;
  amount: bigint;
};

/** Parameters for a DRC721 deposit to DuskEVM. */
export type Drc721DepositParams = BridgeDepositBaseParams & {
  duskContractId: DrcRegistryContractId;
  l1Token: EvmAddress;
  l2Token: EvmAddress;
  tokenId: string | bigint;
};

/** Application-provided or SDK-provided bridge transaction builder. */
export type BridgeTransactionBuilder = DuskL1TransactionBuilder<BridgeOperationIntent>;

/** Dusk L1 contract identifiers used by bridge deposit builders. */
export type BridgeContractsConfig = {
  l1StandardBridgeContractId?: DuskContractId;
  l1Erc721BridgeContractId?: DuskContractId;
};

/** Default gas configuration for generated bridge transactions. */
export type BridgeGasConfig = {
  defaultMinGasLimit?: number;
  l1GasLimit?: bigint;
  gasPriceLux?: bigint;
};

/** Configuration for the default Dusk L1 bridge transaction builder. */
export type CreateBridgeL1TransactionBuilderOptions = BridgeContractsConfig & BridgeGasConfig;

/** Prepared bridge operation enriched with its submitted L1 transaction. */
export type SubmittedBridgeOperation = PreparedBridgeOperation & {
  l1Transaction: DuskL1TransactionRequest;
  submittedTransaction: DuskL1SubmittedTransaction;
  status: BridgeOperationStatus<Record<string, JsonValue>>;
};

/** Polling controls for bridge operation status. */
export type WaitForBridgeOperationStatusOptions = Abortable & {
  intervalMs?: number;
  timeoutMs?: number;
};

/** Dependencies and overrides used to create a bridge client. */
export type CreateBridgeClientOptions = {
  l1?: DuskL1Client;
  contracts?: BridgeContractsConfig;
  gas?: BridgeGasConfig;
  buildL1Transaction?: BridgeTransactionBuilder;
  observeOperationStatus?: (
    operation: PreparedBridgeOperation
  ) => MaybePromise<BridgeOperationStatus<Record<string, JsonValue>>>;
};
