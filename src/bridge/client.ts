import { decodeDuskDepositEnvelope, encodeDuskDepositEnvelope } from "../envelope/index.js";
import { sdkError } from "../errors.js";
import { normalizeEvmAddress } from "../evm-address.js";
import {
  submitDuskL1Transaction,
  type DuskL1ContractReader,
  type DuskL1SubmitOptions,
  type DuskL1SubmittedTransaction,
  type DuskL1TransactionRequest,
  type SubmittedDuskL1Transaction,
} from "../l1/index.js";
import type { BridgeOperationStatus } from "../status/index.js";
import type { EvmAddress, Hex, JsonValue } from "../types.js";
import { normalizeDuskContractIdHex } from "./extradata.js";
import { createBridgeL1TransactionBuilder } from "./l1-builder.js";
import { createBridgeOperationId } from "./operation-id.js";
import {
  buildClaimNativeCreditTransaction,
  observeNativeCredit as observeNativeCreditState,
  readNativeCredit as readNativeCreditState,
  submitClaimNativeCredit,
  type ClaimNativeCreditParams,
  type NativeCredit,
  type NativeCreditTrackingMetadata,
} from "./native-credit.js";
import {
  submittedBridgeOperationStatus,
  waitForBridgeOperationStatus,
} from "./status.js";
import {
  prepareDrc20Withdrawal,
  prepareDrc721Withdrawal,
  prepareNativeContractCreditWithdrawal,
  prepareNativeWithdrawal,
  type Drc20WithdrawalParams,
  type Drc721WithdrawalParams,
  type NativeContractCreditWithdrawalParams,
  type NativeWithdrawalParams,
  type PreparedWithdrawalOperation,
} from "./withdrawal.js";
import type {
  CreateBridgeClientOptions,
  Drc20DepositParams,
  Drc721DepositParams,
  NativeDepositParams,
  PreparedBridgeOperation,
  SubmittedBridgeOperation,
  WaitForBridgeOperationStatusOptions,
} from "./types.js";

/** High-level bridge preparation, submission, and status client. */
export type BridgeClient = {
  prepareNativeDeposit(params: NativeDepositParams): PreparedBridgeOperation;
  prepareDrc20Deposit(params: Drc20DepositParams): PreparedBridgeOperation;
  prepareDrc721Deposit(params: Drc721DepositParams): PreparedBridgeOperation;
  prepareNativeWithdrawal(params: NativeWithdrawalParams): PreparedWithdrawalOperation;
  prepareNativeContractCreditWithdrawal(
    params: NativeContractCreditWithdrawalParams
  ): PreparedWithdrawalOperation;
  prepareDrc20Withdrawal(params: Drc20WithdrawalParams): PreparedWithdrawalOperation;
  prepareDrc721Withdrawal(params: Drc721WithdrawalParams): PreparedWithdrawalOperation;
  buildL1Transaction(operation: PreparedBridgeOperation): Promise<DuskL1TransactionRequest>;
  submitPreparedOperation(operation: PreparedBridgeOperation): Promise<DuskL1SubmittedTransaction>;
  submitNativeDeposit(params: NativeDepositParams): Promise<SubmittedBridgeOperation>;
  submitDrc20Deposit(params: Drc20DepositParams): Promise<SubmittedBridgeOperation>;
  submitDrc721Deposit(params: Drc721DepositParams): Promise<SubmittedBridgeOperation>;
  readNativeCredit(creditId: Hex): Promise<NativeCredit>;
  observeNativeCredit(
    creditId: Hex
  ): Promise<BridgeOperationStatus<NativeCreditTrackingMetadata>>;
  buildNativeCreditClaim(
    params: Omit<ClaimNativeCreditParams, "bridgeContractId">
  ): DuskL1TransactionRequest;
  submitNativeCreditClaim(
    params: Omit<ClaimNativeCreditParams, "bridgeContractId">,
    submitOptions?: DuskL1SubmitOptions
  ): Promise<SubmittedDuskL1Transaction>;
  waitForOperationStatus(
    operation: PreparedBridgeOperation,
    options?: WaitForBridgeOperationStatusOptions
  ): Promise<BridgeOperationStatus<Record<string, JsonValue>>>;
  observeOperationStatus?(
    operation: PreparedBridgeOperation
  ): Promise<BridgeOperationStatus<Record<string, JsonValue>>>;
};

/** Create a bridge client from optional Dusk L1 and status-observer adapters. */
export function createBridgeClient(options: CreateBridgeClientOptions = {}): BridgeClient {
  const defaultL1TransactionBuilder =
    options.buildL1Transaction ??
    (options.contracts
      ? createBridgeL1TransactionBuilder({
          ...options.contracts,
          ...(options.gas ?? {}),
        })
      : undefined);

  const bridge: BridgeClient = {
    prepareNativeDeposit(params) {
      return prepareDeposit({
        asset: { kind: "native", amountLux: params.amountLux },
        l2Recipient: params.l2Recipient,
        minGasLimit: params.minGasLimit,
        l1GasLimit: params.l1GasLimit,
        gasPriceLux: params.gasPriceLux,
        payload: params.payload,
        metadata: params.metadata,
      });
    },
    prepareDrc20Deposit(params) {
      return prepareDeposit({
        asset: {
          kind: "drc20",
          duskContractId: normalizeDuskContractIdHex(params.duskContractId),
          l1Token: params.l1Token,
          l2Token: params.l2Token,
          amount: params.amount,
        },
        l2Recipient: params.l2Recipient,
        minGasLimit: params.minGasLimit,
        l1GasLimit: params.l1GasLimit,
        gasPriceLux: params.gasPriceLux,
        payload: params.payload,
        metadata: params.metadata,
      });
    },
    prepareDrc721Deposit(params) {
      return prepareDeposit({
        asset: {
          kind: "drc721",
          duskContractId: normalizeDuskContractIdHex(params.duskContractId),
          l1Token: params.l1Token,
          l2Token: params.l2Token,
          tokenId: params.tokenId,
        },
        l2Recipient: params.l2Recipient,
        minGasLimit: params.minGasLimit,
        l1GasLimit: params.l1GasLimit,
        gasPriceLux: params.gasPriceLux,
        payload: params.payload,
        metadata: params.metadata,
      });
    },
    prepareNativeWithdrawal,
    prepareNativeContractCreditWithdrawal,
    prepareDrc20Withdrawal,
    prepareDrc721Withdrawal,
    async buildL1Transaction(operation) {
      const l1Transaction =
        operation.l1Transaction ?? (await defaultL1TransactionBuilder?.(operation));
      if (!l1Transaction) {
        throw sdkError("UNSUPPORTED", "No L1 transaction builder configured for bridge operation");
      }
      return l1Transaction;
    },
    async submitPreparedOperation(operation) {
      return submitBridgeOperation(options, bridge, operation).then(
        (submitted) => submitted.submittedTransaction
      );
    },
    submitNativeDeposit(params) {
      return submitBridgeOperation(options, bridge, bridge.prepareNativeDeposit(params));
    },
    submitDrc20Deposit(params) {
      return submitBridgeOperation(options, bridge, bridge.prepareDrc20Deposit(params));
    },
    submitDrc721Deposit(params) {
      return submitBridgeOperation(options, bridge, bridge.prepareDrc721Deposit(params));
    },
    readNativeCredit(creditId) {
      return readNativeCreditState(requireL1Reader(options), {
        bridgeContractId: requireStandardBridgeContractId(options),
        creditId,
      });
    },
    observeNativeCredit(creditId) {
      return observeNativeCreditState(requireL1Reader(options), {
        bridgeContractId: requireStandardBridgeContractId(options),
        creditId,
      });
    },
    buildNativeCreditClaim(params) {
      return buildClaimNativeCreditTransaction({
        ...params,
        bridgeContractId: requireStandardBridgeContractId(options),
      });
    },
    submitNativeCreditClaim(params, submitOptions) {
      if (!options.l1) throw sdkError("UNSUPPORTED", "No Dusk L1 client configured");
      return submitClaimNativeCredit(
        options.l1,
        {
          ...params,
          bridgeContractId: requireStandardBridgeContractId(options),
        },
        submitOptions
      );
    },
    async waitForOperationStatus(operation, waitOptions) {
      const observeOperationStatus = bridge.observeOperationStatus;
      if (!observeOperationStatus) {
        throw sdkError("UNSUPPORTED", "No bridge operation status observer configured");
      }
      return waitForBridgeOperationStatus(operation, observeOperationStatus, waitOptions);
    },
  };

  if (options.observeOperationStatus) {
    bridge.observeOperationStatus = async (operation) => options.observeOperationStatus!(operation);
  }

  return bridge;
}

function requireStandardBridgeContractId(options: CreateBridgeClientOptions): string {
  const contractId = options.contracts?.l1StandardBridgeContractId;
  if (!contractId) throw sdkError("UNSUPPORTED", "L1 Standard Bridge contract id is required");
  return contractId;
}

function requireL1Reader(options: CreateBridgeClientOptions): DuskL1ContractReader {
  if (!options.l1?.readContract) {
    throw sdkError("UNSUPPORTED", "The Dusk L1 client does not expose readContract");
  }
  return { readContract: options.l1.readContract.bind(options.l1) };
}

type DepositInput = {
  asset: PreparedBridgeOperation["asset"];
  l2Recipient: EvmAddress;
  minGasLimit?: number | undefined;
  l1GasLimit?: bigint | undefined;
  gasPriceLux?: bigint | undefined;
  payload?: NativeDepositParams["payload"] | undefined;
  metadata?: NativeDepositParams["metadata"] | undefined;
};

function prepareDeposit(input: DepositInput): PreparedBridgeOperation {
  const asset = normalizeBridgeAsset(input.asset);
  const l2Recipient = normalizeEvmAddress(input.l2Recipient, "Bridge L2 recipient");
  const depositEnvelopeHex = encodeDuskDepositEnvelope({
    target: {
      kind: "evm",
      value: l2Recipient,
    },
    payload: input.payload ?? "0x",
  });
  const gas = depositGas(input);

  return {
    id: depositOperationId(asset, l2Recipient, depositEnvelopeHex),
    direction: "l1-to-l2",
    asset,
    depositEnvelopeHex,
    depositEnvelope: decodeDuskDepositEnvelope(depositEnvelopeHex),
    ...(gas === undefined ? {} : { gas }),
    metadata: {
      ...(input.metadata ?? {}),
      l2Recipient,
    },
  };
}

function normalizeBridgeAsset(
  asset: PreparedBridgeOperation["asset"]
): PreparedBridgeOperation["asset"] {
  switch (asset.kind) {
    case "native":
      return asset;
    case "drc20":
    case "drc721":
      return {
        ...asset,
        l1Token: normalizeEvmAddress(asset.l1Token, "Bridge L1 token"),
        l2Token: normalizeEvmAddress(asset.l2Token, "Bridge L2 token"),
      };
  }
}

function depositGas(input: DepositInput): PreparedBridgeOperation["gas"] {
  if (
    input.minGasLimit === undefined &&
    input.l1GasLimit === undefined &&
    input.gasPriceLux === undefined
  ) {
    return undefined;
  }

  return {
    ...(input.minGasLimit === undefined ? {} : { minGasLimit: input.minGasLimit }),
    ...(input.l1GasLimit === undefined ? {} : { l1GasLimit: input.l1GasLimit }),
    ...(input.gasPriceLux === undefined ? {} : { gasPriceLux: input.gasPriceLux }),
  };
}

async function submitBridgeOperation(
  options: CreateBridgeClientOptions,
  bridge: Pick<BridgeClient, "buildL1Transaction">,
  operation: PreparedBridgeOperation
): Promise<SubmittedBridgeOperation> {
  if (!options.l1) throw sdkError("UNSUPPORTED", "No Dusk L1 client configured");

  const l1Transaction = await bridge.buildL1Transaction(operation);
  const submitted = await submitDuskL1Transaction(options.l1, l1Transaction);
  const submittedOperation: SubmittedBridgeOperation = {
    ...operation,
    l1Transaction: submitted.request,
    submittedTransaction: submitted.submitted,
    status: submittedBridgeOperationStatus(operation, submitted.submitted),
  };
  return submittedOperation;
}

function depositOperationId(
  asset: PreparedBridgeOperation["asset"],
  recipient: string,
  depositEnvelopeHex: `0x${string}`
): string {
  return createBridgeOperationId(
    "deposit",
    depositOperationIdPayload(asset, recipient, depositEnvelopeHex)
  );
}

function depositOperationIdPayload(
  asset: PreparedBridgeOperation["asset"],
  recipient: string,
  depositEnvelopeHex: `0x${string}`
): JsonValue {
  const base = {
    // Keep the beta.3 operation-ID preimage stable while clarifying the public field name.
    envelopeHex: depositEnvelopeHex,
    prefix: "deposit",
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
          duskContractId: asset.duskContractId,
          l1Token: asset.l1Token.toLowerCase(),
          l2Token: asset.l2Token.toLowerCase(),
          amount: asset.amount.toString(),
        },
      };
    case "drc721":
      return {
        ...base,
        asset: {
          kind: asset.kind,
          duskContractId: asset.duskContractId,
          l1Token: asset.l1Token.toLowerCase(),
          l2Token: asset.l2Token.toLowerCase(),
          tokenId: asset.tokenId.toString(),
        },
      };
  }
}
