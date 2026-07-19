import {
  bytesToHex,
  decodeFunctionData,
  encodeAbiParameters,
  keccak256,
  parseAbi,
  type Hex,
} from "viem";
import { weiToLuxExact } from "../amount.js";
import { sdkError } from "../errors.js";
import { normalizeEvmAddress } from "../evm-address.js";
import { duskL1ContractMethods } from "../l1/dusk-contract-interface.js";
import {
  submitDuskL1Transaction,
  type DuskL1Client,
  type DuskL1ContractReadRequest,
  type DuskL1ContractReader,
  type DuskL1SubmitOptions,
  type DuskL1TransactionRequest,
  type SubmittedDuskL1Transaction,
} from "../l1/index.js";
import {
  L2_CROSS_DOMAIN_MESSENGER_ADDRESS,
  L2_STANDARD_BRIDGE_ADDRESS,
} from "../l2/index.js";
import type { BridgeOperationStatus } from "../status/index.js";
import type { EvmAddress, JsonValue, LuxAmount } from "../types.js";
import {
  decodeDuskNativeContractCredit,
  duskContractIdToEvmAddress,
} from "./asset-recipient.js";
import type { WithdrawalTransaction } from "./withdrawal.js";

const relayMessageAbi = parseAbi([
  "function relayMessage(uint256 nonce,address sender,address target,uint256 value,uint256 minGasLimit,bytes message)",
]);
const finalizeBridgeEthAbi = parseAbi([
  "function finalizeBridgeETH(address from,address to,uint256 amount,bytes extraData)",
]);
const UINT64_MAX = (1n << 64n) - 1n;

/** On-chain native-credit state codes. */
export const nativeCreditStatusCodes = {
  missing: 0,
  pending: 1,
  claiming: 2,
  claimed: 3,
} as const;

/** Stable native-credit lifecycle names. */
export type NativeCreditState = keyof typeof nativeCreditStatusCodes;

/** Authoritative native DUSK credit returned by L1StandardBridge. */
export type NativeCredit = {
  creditId: Hex;
  targetContractId: Hex;
  l2Sender: EvmAddress;
  amountLux: LuxAmount;
  payloadHash: Hex;
  state: NativeCreditState;
  stateCode: 0 | 1 | 2 | 3;
};

/** Native-credit fields authenticated by the nested OP relay message. */
export type ParsedNativeCreditWithdrawal = {
  creditId: Hex;
  targetContractId: Hex;
  targetEvmAddress: EvmAddress;
  payload: Hex;
  payloadHash: Hex;
  l2Sender: EvmAddress;
  l1StandardBridge: EvmAddress;
  amountWei: bigint;
  amountLux: LuxAmount;
};

/** Optional canonical-address checks applied while parsing a credit withdrawal. */
export type ParseNativeCreditWithdrawalOptions = {
  l1CrossDomainMessenger?: EvmAddress;
  l1StandardBridge?: EvmAddress;
};

/** Parameters shared by native-credit reads. */
export type ReadNativeCreditParams = {
  bridgeContractId: string;
  creditId: Hex;
};

/** Parameters for building or submitting a native-credit claim. */
export type ClaimNativeCreditParams = ReadNativeCreditParams & {
  payload: Hex;
  gasLimit?: bigint;
  gasPriceLux?: bigint;
};

/** Wallet-facing native-credit lifecycle stages. */
export type NativeCreditLifecycleStage =
  | "credit_missing"
  | "credit_pending"
  | "claim_in_progress"
  | "claimed";

/** Persistable status metadata for one native contract credit. */
export type NativeCreditTrackingMetadata = Record<string, JsonValue> & {
  stage: NativeCreditLifecycleStage;
  creditId: Hex;
  targetContractId: Hex;
  l2Sender: EvmAddress;
  amountLux: string;
  payloadHash: Hex;
  stateCode: number;
};

/** Decode and authenticate the native-credit fields inside an OP withdrawal. */
export function parseNativeCreditWithdrawal(
  withdrawal: WithdrawalTransaction,
  options: ParseNativeCreditWithdrawalOptions = {}
): ParsedNativeCreditWithdrawal {
  const outerSender = normalizeEvmAddress(withdrawal.sender, "withdrawal sender");
  if (outerSender !== L2_CROSS_DOMAIN_MESSENGER_ADDRESS) {
    throw sdkError("INVALID_OPERATION", "Native credit withdrawal was not sent by the L2 Messenger");
  }
  if (
    options.l1CrossDomainMessenger !== undefined &&
    normalizeEvmAddress(withdrawal.target, "withdrawal target") !==
      normalizeEvmAddress(options.l1CrossDomainMessenger, "L1 Messenger")
  ) {
    throw sdkError("INVALID_OPERATION", "Native credit withdrawal targets the wrong L1 Messenger");
  }

  const relay = decodeCall(relayMessageAbi, withdrawal.data, "relayMessage");
  const [nonce, senderValue, targetValue, value, minGasLimit, message] = relay.args as readonly [
    bigint,
    EvmAddress,
    EvmAddress,
    bigint,
    bigint,
    Hex,
  ];
  const sender = normalizeEvmAddress(senderValue, "relay sender");
  const target = normalizeEvmAddress(targetValue, "relay target");
  if (sender !== L2_STANDARD_BRIDGE_ADDRESS) {
    throw sdkError("INVALID_OPERATION", "Native credit relay was not sent by the L2 Standard Bridge");
  }
  if (withdrawal.value !== value) {
    throw sdkError("INVALID_OPERATION", "Native credit withdrawal and relay values do not match");
  }
  if (
    options.l1StandardBridge !== undefined &&
    target !== normalizeEvmAddress(options.l1StandardBridge, "L1 Standard Bridge")
  ) {
    throw sdkError("INVALID_OPERATION", "Native credit relay targets the wrong L1 Standard Bridge");
  }

  const finalize = decodeCall(finalizeBridgeEthAbi, message, "finalizeBridgeETH");
  const [fromValue, toValue, amountWei, extraData] = finalize.args as readonly [
    EvmAddress,
    EvmAddress,
    bigint,
    Hex,
  ];
  if (amountWei !== value) {
    throw sdkError("INVALID_OPERATION", "Native credit bridge and relay amounts do not match");
  }

  const recipient = decodeDuskNativeContractCredit(extraData);
  const targetEvmAddress = duskContractIdToEvmAddress(recipient.targetContractId);
  if (normalizeEvmAddress(toValue, "native credit recipient") !== targetEvmAddress) {
    throw sdkError(
      "INVALID_OPERATION",
      "Native credit EVM recipient does not match the target ContractId"
    );
  }

  const creditId = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes" },
      ],
      [nonce, sender, target, value, minGasLimit, message]
    )
  );
  return {
    creditId,
    targetContractId: recipient.targetContractId,
    targetEvmAddress,
    payload: recipient.payload,
    payloadHash: keccak256(recipient.payload),
    l2Sender: normalizeEvmAddress(fromValue, "native credit L2 sender"),
    l1StandardBridge: target,
    amountWei,
    amountLux: weiToLuxExact(amountWei),
  };
}

/** Build the authoritative L1StandardBridge native-credit read request. */
export function buildNativeCreditReadRequest(
  params: ReadNativeCreditParams
): DuskL1ContractReadRequest {
  return {
    contractId: requireBridgeContractId(params.bridgeContractId),
    method: duskL1ContractMethods.l1StandardBridge.nativeCredit.name,
    args: [normalizeBytes32(params.creditId, "native credit id")],
  };
}

/** Read and normalize one native credit from L1StandardBridge. */
export async function readNativeCredit(
  reader: DuskL1ContractReader,
  params: ReadNativeCreditParams
): Promise<NativeCredit> {
  const creditId = normalizeBytes32(params.creditId, "native credit id");
  const raw = await reader.readContract(buildNativeCreditReadRequest({ ...params, creditId }));
  return normalizeNativeCredit(creditId, raw);
}

/** Build a Dusk L1 transaction that claims one pending native credit. */
export function buildClaimNativeCreditTransaction(
  params: ClaimNativeCreditParams
): DuskL1TransactionRequest {
  const request: DuskL1TransactionRequest = {
    kind: "contract_call",
    contractId: requireBridgeContractId(params.bridgeContractId),
    method: duskL1ContractMethods.l1StandardBridge.claimNativeCredit.name,
    args: [
      normalizeBytes32(params.creditId, "native credit id"),
      normalizeByteHex(params.payload, "native credit payload"),
    ],
    metadata: {
      bridgeDirection: "l2-to-l1",
      nativeCreditId: normalizeBytes32(params.creditId, "native credit id"),
    },
  };
  if (params.gasLimit !== undefined) request.gasLimit = params.gasLimit;
  if (params.gasPriceLux !== undefined) request.gasPriceLux = params.gasPriceLux;
  return request;
}

/** Build and submit a native-credit claim through a Dusk L1 client. */
export async function submitClaimNativeCredit(
  client: DuskL1Client,
  params: ClaimNativeCreditParams,
  options?: DuskL1SubmitOptions
): Promise<SubmittedDuskL1Transaction> {
  return submitDuskL1Transaction(client, buildClaimNativeCreditTransaction(params), options);
}

/** Convert authoritative credit state into a wallet-facing lifecycle status. */
export function nativeCreditLifecycleStatus(
  credit: NativeCredit,
  now: () => number = Date.now
): BridgeOperationStatus<NativeCreditTrackingMetadata> {
  const stage = nativeCreditStage(credit.state);
  const phase =
    credit.state === "claimed"
      ? "finalized"
      : credit.state === "claiming"
        ? "submitted"
        : credit.state === "pending"
          ? "accepted"
          : "prepared";
  return {
    phase,
    updatedAt: now(),
    ...(credit.state === "missing" ? { message: "Native credit has not been created" } : {}),
    metadata: {
      stage,
      creditId: credit.creditId,
      targetContractId: credit.targetContractId,
      l2Sender: credit.l2Sender,
      amountLux: credit.amountLux.toString(),
      payloadHash: credit.payloadHash,
      stateCode: credit.stateCode,
    },
  };
}

/** Read one credit and return its wallet-facing lifecycle status. */
export async function observeNativeCredit(
  reader: DuskL1ContractReader,
  params: ReadNativeCreditParams,
  now?: () => number
): Promise<BridgeOperationStatus<NativeCreditTrackingMetadata>> {
  return nativeCreditLifecycleStatus(await readNativeCredit(reader, params), now);
}

function decodeCall(abi: typeof relayMessageAbi, data: Hex, expected: string): ReturnType<typeof decodeFunctionData>;
function decodeCall(abi: typeof finalizeBridgeEthAbi, data: Hex, expected: string): ReturnType<typeof decodeFunctionData>;
function decodeCall(abi: typeof relayMessageAbi | typeof finalizeBridgeEthAbi, data: Hex, expected: string) {
  try {
    const decoded = decodeFunctionData({ abi, data });
    if (decoded.functionName !== expected) throw new Error(`unexpected ${decoded.functionName}`);
    return decoded;
  } catch (error) {
    throw sdkError("INVALID_OPERATION", `Native credit ${expected} calldata is invalid`, error);
  }
}

function normalizeNativeCredit(creditId: Hex, raw: unknown): NativeCredit {
  const values = nativeCreditTuple(raw);
  const targetContractId = normalizeBytes32(values[0], "native credit target ContractId");
  const l2Sender = normalizeAddressValue(values[1], "native credit L2 sender");
  const amountLux = normalizeUnsigned(values[2], "native credit amount");
  if (amountLux > UINT64_MAX) {
    throw sdkError("CLIENT_ERROR", "Native credit amount does not fit u64");
  }
  const payloadHash = normalizeBytes32(values[3], "native credit payload hash");
  const stateCodeValue = normalizeUnsigned(values[4], "native credit state");
  if (stateCodeValue > 3n) {
    throw sdkError("CLIENT_ERROR", `Native credit returned unknown state ${stateCodeValue}`);
  }
  const stateCode = Number(stateCodeValue) as 0 | 1 | 2 | 3;
  return {
    creditId,
    targetContractId,
    l2Sender,
    amountLux,
    payloadHash,
    state: nativeCreditState(stateCode),
    stateCode,
  };
}

function nativeCreditTuple(raw: unknown): readonly unknown[] {
  if (Array.isArray(raw) && raw.length === 5) return raw;
  if (raw && typeof raw === "object") {
    const value = raw as Record<string, unknown>;
    const tuple = [
      value.targetContractId ?? value.target_contract_id ?? value["0"],
      value.l2Sender ?? value.l2_sender ?? value["1"],
      value.amountLux ?? value.amount_lux ?? value["2"],
      value.payloadHash ?? value.payload_hash ?? value["3"],
      value.stateCode ?? value.status ?? value["4"],
    ];
    if (tuple.every((item) => item !== undefined)) return tuple;
  }
  throw sdkError("CLIENT_ERROR", "L1 Standard Bridge returned an invalid native credit tuple", raw);
}

function normalizeAddressValue(value: unknown, label: string): EvmAddress {
  if (typeof value === "string") return normalizeEvmAddress(value, label);
  return normalizeEvmAddress(bytesToHex(normalizeByteArray(value, 20, label)), label);
}

function normalizeBytes32(value: unknown, label: string): Hex {
  if (typeof value === "string" && /^0[xX][0-9a-fA-F]{64}$/.test(value)) {
    return `0x${value.slice(2).toLowerCase()}`;
  }
  return bytesToHex(normalizeByteArray(value, 32, label));
}

function normalizeByteHex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0[xX](?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw sdkError("INVALID_OPERATION", `${label} must be even-length 0x-prefixed hex`);
  }
  return `0x${value.slice(2).toLowerCase()}`;
}

function normalizeByteArray(value: unknown, length: number, label: string): Uint8Array {
  const bytes = value instanceof Uint8Array ? value : Array.isArray(value) ? Uint8Array.from(value) : undefined;
  if (!bytes || bytes.length !== length) {
    throw sdkError("CLIENT_ERROR", `${label} must contain ${length} bytes`);
  }
  return bytes;
}

function normalizeUnsigned(value: unknown, label: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && (/^\d+$/.test(value) || /^0[xX][0-9a-fA-F]+$/.test(value))) {
    return BigInt(value);
  }
  throw sdkError("CLIENT_ERROR", `${label} is not an unsigned integer`, value);
}

function nativeCreditState(code: 0 | 1 | 2 | 3): NativeCreditState {
  return (["missing", "pending", "claiming", "claimed"] as const)[code];
}

function nativeCreditStage(state: NativeCreditState): NativeCreditLifecycleStage {
  switch (state) {
    case "missing":
      return "credit_missing";
    case "pending":
      return "credit_pending";
    case "claiming":
      return "claim_in_progress";
    case "claimed":
      return "claimed";
  }
}

function requireBridgeContractId(contractId: string): string {
  if (!contractId) throw sdkError("UNSUPPORTED", "L1 Standard Bridge contract id is required");
  return contractId;
}
