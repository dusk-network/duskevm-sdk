import { sdkError } from "../errors.js";
import type { DuskL1TransactionRequest } from "../l1/index.js";
import type { JsonValue } from "../types.js";
import { normalizeUint32 } from "../uint32.js";
import { encodeDrcRegistryExtraData } from "./extradata.js";
import type {
  BridgeAsset,
  BridgeTransactionBuilder,
  CreateBridgeL1TransactionBuilderOptions,
  PreparedBridgeOperation,
} from "./types.js";

export const DEFAULT_BRIDGE_MIN_GAS_LIMIT = 200_000;

export function createBridgeL1TransactionBuilder(
  options: CreateBridgeL1TransactionBuilderOptions
): BridgeTransactionBuilder {
  return (operation) => buildBridgeL1Transaction(operation, options);
}

export function buildBridgeL1Transaction(
  operation: PreparedBridgeOperation,
  options: CreateBridgeL1TransactionBuilderOptions
): DuskL1TransactionRequest {
  const common = baseRequest(operation, options);

  switch (operation.asset.kind) {
    case "native":
      return {
        ...common,
        contractId: requireContractId(options.l1StandardBridgeContractId, "L1 standard bridge"),
        method: "depositETHToWithValue",
        amountLux: operation.asset.amountLux,
        args: [
          l2Recipient(operation),
          operation.asset.amountLux.toString(),
          minGasLimit(operation, options),
          operation.envelopeHex,
        ],
      };
    case "drc20":
      return {
        ...common,
        contractId: requireContractId(options.l1StandardBridgeContractId, "L1 standard bridge"),
        method: "bridgeERC20To",
        args: tokenBridgeArgs(operation.asset, operation, options),
      };
    case "drc721":
      return {
        ...common,
        contractId: requireContractId(options.l1Erc721BridgeContractId, "L1 ERC721 bridge"),
        method: "bridgeERC721To",
        args: tokenBridgeArgs(operation.asset, operation, options),
      };
  }
}

function tokenBridgeArgs(
  asset: Extract<BridgeAsset, { kind: "drc20" | "drc721" }>,
  operation: PreparedBridgeOperation,
  options: Pick<CreateBridgeL1TransactionBuilderOptions, "defaultMinGasLimit">
): JsonValue[] {
  return [
    asset.l1Token,
    asset.l2Token,
    l2Recipient(operation),
    asset.kind === "drc20" ? asset.amount.toString() : asset.tokenId.toString(),
    minGasLimit(operation, options),
    encodeDrcRegistryExtraData({
      kind: asset.kind,
      duskContractId: asset.duskContractId,
      payload: operation.envelopeHex,
    }),
  ];
}

function baseRequest(
  operation: PreparedBridgeOperation,
  options: CreateBridgeL1TransactionBuilderOptions
): DuskL1TransactionRequest {
  const request: DuskL1TransactionRequest = {
    kind: "contract_call",
    metadata: {
      operationId: operation.id,
      bridgeDirection: operation.direction,
      assetKind: operation.asset.kind,
    },
  };

  const gasLimit = operationGasLimit(operation, options);
  const gasPriceLux = operationGasPrice(operation, options);
  if (gasLimit !== undefined) request.gasLimit = gasLimit;
  if (gasPriceLux !== undefined) request.gasPriceLux = gasPriceLux;
  return request;
}

function l2Recipient(operation: PreparedBridgeOperation): JsonValue {
  const recipient = operation.metadata.l2Recipient;
  if (typeof recipient !== "string") {
    throw sdkError("INVALID_OPERATION", "Bridge operation is missing an L2 recipient");
  }
  return recipient;
}

function minGasLimit(
  operation: PreparedBridgeOperation,
  options: Pick<CreateBridgeL1TransactionBuilderOptions, "defaultMinGasLimit">
): number {
  return normalizeUint32(
    operation.gas?.minGasLimit ?? options.defaultMinGasLimit ?? DEFAULT_BRIDGE_MIN_GAS_LIMIT,
    "Bridge minGasLimit"
  );
}

function operationGasLimit(
  operation: PreparedBridgeOperation,
  options: Pick<CreateBridgeL1TransactionBuilderOptions, "l1GasLimit">
): bigint | undefined {
  return operation.gas?.l1GasLimit ?? options.l1GasLimit;
}

function operationGasPrice(
  operation: PreparedBridgeOperation,
  options: Pick<CreateBridgeL1TransactionBuilderOptions, "gasPriceLux">
): bigint | undefined {
  return operation.gas?.gasPriceLux ?? options.gasPriceLux;
}

function requireContractId(contractId: string | undefined, name: string): string {
  if (!contractId) throw sdkError("UNSUPPORTED", `${name} contract id is required`);
  return contractId;
}
