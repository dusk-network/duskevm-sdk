import {
  encodeAbiParameters,
  fromRlp,
  hexToBytes,
  keccak256,
  toHex,
  toRlp,
  type Hex,
} from "viem";
import { L2_TO_L1_MESSAGE_PASSER_ADDRESS } from "../l2/index.js";
import { sdkError } from "../errors.js";
import { duskL1ContractMethods, type DuskL1ContractReader } from "../l1/index.js";
import type { EvmAddress } from "../types.js";
import type { OutputRootProof, WithdrawalProofData } from "../bridge/index.js";

const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;
const DEFAULT_GAME_SEARCH_DEPTH = 64n;
const GAME_PAGE_SIZE = 32n;
const CHALLENGER_WINS = 1n;
const portalMethods = duskL1ContractMethods.optimismPortal;
const gameFactoryMethods = duskL1ContractMethods.disputeGameFactory;

/** Minimal L2 read surface used to construct a withdrawal proof. */
export type WithdrawalProofL2Client = {
  getBlock(parameters: { blockNumber: bigint }): Promise<{
    hash: Hex | null;
    stateRoot: Hex;
  }>;
  getProof(parameters: {
    address: EvmAddress;
    storageKeys: readonly Hex[];
    blockNumber: bigint;
  }): Promise<{
    storageHash: Hex;
    storageProof: readonly { proof: readonly Hex[] }[];
  }>;
};

/** Dispute-game projection needed by proof selection. */
export type WithdrawalGame = {
  index: bigint;
  gameProxy: EvmAddress;
  rootClaim: Hex;
  l2BlockNumber: bigint;
};

/** Reader abstraction for dispute-game candidates and Portal proof admission. */
export type WithdrawalGameReader = {
  respectedGameType(): Promise<number>;
  gameCount(): Promise<bigint>;
  latestGames(gameType: number, start: bigint, count: bigint): Promise<readonly { index: bigint }[]>;
  game(index: bigint): Promise<WithdrawalGame>;
  isGameEligible(game: WithdrawalGame): Promise<boolean>;
};

/** Selected dispute game plus the proof accepted by OptimismPortal. */
export type SelectedWithdrawalProof = WithdrawalProofData & {
  disputeGameProxy: EvmAddress;
  l2BlockNumber: bigint;
  outputRoot: Hex;
};

/** Adapt a wallet-neutral Dusk contract reader to proof discovery. */
export function createWithdrawalGameReader(params: {
  reader: DuskL1ContractReader;
  portalContractId: string;
  disputeGameFactoryContractId: string;
  nowSeconds?: () => bigint;
}): WithdrawalGameReader {
  requireContractId(params.portalContractId, "OptimismPortal");
  requireContractId(params.disputeGameFactoryContractId, "DisputeGameFactory");
  const read = params.reader.readContract.bind(params.reader);
  const nowSeconds = params.nowSeconds ?? (() => BigInt(Math.floor(Date.now() / 1_000)));

  return {
    async respectedGameType() {
      return Number(
        normalizeBigint(
          await read({
            contractId: params.portalContractId,
            method: portalMethods.respectedGameType.name,
          }),
          "respected game type"
        )
      );
    },
    async gameCount() {
      return normalizeBigint(
        await read({
          contractId: params.disputeGameFactoryContractId,
          method: gameFactoryMethods.gameCount.name,
        }),
        "game count"
      );
    },
    async latestGames(gameType, start, count) {
      const raw = await read({
        contractId: params.disputeGameFactoryContractId,
        method: gameFactoryMethods.findLatestGames.name,
        args: [gameType, bigintToU256(start), bigintToU256(count)],
      });
      if (!Array.isArray(raw)) {
        throw sdkError("CLIENT_ERROR", "findLatestGames returned a non-array result", raw);
      }
      return raw.map((entry, position) => ({
        index: normalizeBigint(tupleValue(entry, "index", 0), `game index ${position}`),
      }));
    },
    async game(index) {
      const [metadata, gameAtIndex] = await Promise.all([
        read({
          contractId: params.disputeGameFactoryContractId,
          method: gameFactoryMethods.gameMetadataAtIndex.name,
          args: bigintToU256(index),
        }),
        read({
          contractId: params.disputeGameFactoryContractId,
          method: gameFactoryMethods.gameAtIndex.name,
          args: bigintToU256(index),
        }),
      ]);
      const explicitL2Block = tupleValue(metadata, "l2SequenceNumber", 2);
      const extraData = tupleValue(metadata, "extraData", 3);
      return {
        index,
        gameProxy: normalizeAddress(tupleValue(gameAtIndex, "gameProxy", 2), "game proxy"),
        rootClaim: normalizeBytes32(tupleValue(metadata, "rootClaim", 0), "game root claim"),
        l2BlockNumber: isZero(explicitL2Block)
          ? l2SequenceFromExtraData(extraData)
          : normalizeBigint(explicitL2Block, "game L2 block number"),
      };
    },
    async isGameEligible(game) {
      const [anchorStateRegistryId, gameContractId] = await Promise.all([
        read({
          contractId: params.disputeGameFactoryContractId,
          method: gameFactoryMethods.anchorStateRegistryContractId.name,
        }),
        read({
          contractId: params.disputeGameFactoryContractId,
          method: gameFactoryMethods.gameContractId.name,
          args: game.gameProxy,
        }),
      ]);
      const anchorStateRegistryContractId = normalizeContractId(
        anchorStateRegistryId,
        "AnchorStateRegistry contract id"
      );
      const disputeGameContractId = normalizeContractId(
        gameContractId,
        "dispute game contract id"
      );
      if (!anchorStateRegistryContractId || !disputeGameContractId) return false;

      const [proper, respected, status, createdAt] = await Promise.all([
        read({
          contractId: anchorStateRegistryContractId,
          method: duskL1ContractMethods.anchorStateRegistry.isGameProper.name,
          args: game.gameProxy,
        }),
        read({
          contractId: anchorStateRegistryContractId,
          method: duskL1ContractMethods.anchorStateRegistry.isGameRespected.name,
          args: game.gameProxy,
        }),
        read({
          contractId: disputeGameContractId,
          method: duskL1ContractMethods.faultDisputeGameHub.statusForGame.name,
          args: game.gameProxy,
        }),
        read({
          contractId: disputeGameContractId,
          method: duskL1ContractMethods.faultDisputeGameHub.createdAtForGame.name,
          args: game.gameProxy,
        }),
      ]);
      const createdAtSeconds = normalizeUnsignedBigint(createdAt, "game creation timestamp");
      return (
        normalizeBoolean(proper, "isGameProper") &&
        normalizeBoolean(respected, "isGameRespected") &&
        normalizeUnsignedBigint(status, "game status") !== CHALLENGER_WINS &&
        createdAtSeconds !== 0n &&
        nowSeconds() > createdAtSeconds
      );
    },
  };
}

/** Find the newest Portal-admissible dispute game whose output root covers a withdrawal. */
export async function findWithdrawalProof(params: {
  l2Client: WithdrawalProofL2Client;
  gameReader: WithdrawalGameReader;
  withdrawalHash: Hex;
  withdrawalBlockNumber: bigint;
  maxGames?: bigint | number;
}): Promise<SelectedWithdrawalProof> {
  const withdrawalHash = normalizeBytes32(params.withdrawalHash, "withdrawal hash");
  const maxGames = normalizePositiveBigint(
    params.maxGames ?? DEFAULT_GAME_SEARCH_DEPTH,
    "maximum dispute games"
  );
  const [gameType, gameCount] = await Promise.all([
    params.gameReader.respectedGameType(),
    params.gameReader.gameCount(),
  ]);
  if (gameCount === 0n) {
    throw sdkError("UNAVAILABLE", "No dispute games have been proposed yet");
  }

  let start = gameCount - 1n;
  let remaining = maxGames;
  let lastError: unknown;

  while (remaining > 0n) {
    const pageSize = remaining < GAME_PAGE_SIZE ? remaining : GAME_PAGE_SIZE;
    const candidates = await params.gameReader.latestGames(gameType, start, pageSize);
    if (candidates.length === 0) break;

    for (const candidate of candidates) {
      try {
        const game = await params.gameReader.game(candidate.index);
        if (game.l2BlockNumber < params.withdrawalBlockNumber) continue;
        if (!(await params.gameReader.isGameEligible(game))) continue;
        const proof = await buildWithdrawalOutputProof({
          client: params.l2Client,
          withdrawalHash,
          blockNumber: game.l2BlockNumber,
        });
        if (proof.outputRoot.toLowerCase() !== game.rootClaim.toLowerCase()) continue;
        return {
          disputeGameIndex: game.index,
          disputeGameProxy: game.gameProxy,
          l2BlockNumber: game.l2BlockNumber,
          outputRoot: proof.outputRoot,
          outputRootProof: proof.outputRootProof,
          withdrawalProof: proof.withdrawalProof,
        };
      } catch (error) {
        lastError = error;
      }
    }

    remaining -= BigInt(candidates.length);
    const oldest = candidates.at(-1)!.index;
    if (oldest === 0n) break;
    start = oldest - 1n;
  }

  throw sdkError(
    "UNAVAILABLE",
    "No dispute game with a matching output root covers this withdrawal",
    lastError
  );
}

/** Construct the OP output-root and storage proof for a particular L2 block. */
export async function buildWithdrawalOutputProof(params: {
  client: WithdrawalProofL2Client;
  withdrawalHash: Hex;
  blockNumber: bigint;
}): Promise<{
  outputRoot: Hex;
  outputRootProof: OutputRootProof;
  withdrawalProof: readonly Hex[];
}> {
  const withdrawalHash = normalizeBytes32(params.withdrawalHash, "withdrawal hash");
  const storageKey = withdrawalStorageKey(withdrawalHash);
  const [block, accountProof] = await Promise.all([
    params.client.getBlock({ blockNumber: params.blockNumber }),
    params.client.getProof({
      address: L2_TO_L1_MESSAGE_PASSER_ADDRESS,
      storageKeys: [storageKey],
      blockNumber: params.blockNumber,
    }),
  ]);
  if (!block.hash) throw sdkError("UNAVAILABLE", `L2 block ${params.blockNumber} has no hash`);
  const storageProof = accountProof.storageProof[0];
  if (!storageProof) throw sdkError("UNAVAILABLE", "Withdrawal storage proof is not available");

  const outputRootProof: OutputRootProof = {
    version: ZERO_HASH,
    stateRoot: normalizeBytes32(block.stateRoot, "L2 state root"),
    messagePasserStorageRoot: normalizeBytes32(
      accountProof.storageHash,
      "message passer storage root"
    ),
    latestBlockhash: normalizeBytes32(block.hash, "L2 block hash"),
  };
  return {
    outputRoot: hashOutputRootProof(outputRootProof),
    outputRootProof,
    withdrawalProof: appendEmbeddedTerminalNode(keccak256(storageKey), storageProof.proof),
  };
}

/** Storage slot used by L2ToL1MessagePasser.sentMessages. */
export function withdrawalStorageKey(withdrawalHash: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }],
      [normalizeBytes32(withdrawalHash, "withdrawal hash"), 0n]
    )
  );
}

/** Hash an OP output-root proof exactly as the dispute game root claim does. */
export function hashOutputRootProof(proof: OutputRootProof): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        normalizeBytes32(proof.version, "output root version"),
        normalizeBytes32(proof.stateRoot, "output state root"),
        normalizeBytes32(proof.messagePasserStorageRoot, "output message passer storage root"),
        normalizeBytes32(proof.latestBlockhash, "output latest block hash"),
      ]
    )
  );
}

/** Include embedded MPT descendants omitted by some eth_getProof clients. */
export function appendEmbeddedTerminalNode(key: Hex, proof: readonly Hex[]): readonly Hex[] {
  const nibbles = Array.from(hexToBytes(key)).flatMap((byte) => [byte >> 4, byte & 0x0f]);
  let cursor = 0;

  for (let index = 0; index < proof.length; index += 1) {
    let node: ReturnType<typeof fromRlp>;
    try {
      node = fromRlp(proof[index]!);
    } catch {
      return proof;
    }
    if (!Array.isArray(node)) return proof;

    const selected = selectTrieChild(node, nibbles, cursor);
    if (!selected) return proof;
    cursor = selected.cursor;
    if (selected.leaf) return proof;

    if (index === proof.length - 1) {
      const normalized = [...proof];
      let embedded = embeddedNode(selected.child);
      while (embedded && hexToBytes(embedded.rlp).length < 32) {
        normalized.push(embedded.rlp);
        const next = selectTrieChild(embedded.node, nibbles, cursor);
        if (!next || next.leaf) return normalized;
        cursor = next.cursor;
        embedded = embeddedNode(next.child);
      }
      return normalized;
    }
  }
  return proof;
}

function selectTrieChild(
  node: ReturnType<typeof fromRlp>,
  nibbles: readonly number[],
  cursor: number
): { child?: unknown; cursor: number; leaf: boolean } | undefined {
  if (!Array.isArray(node)) return undefined;
  if (node.length === 17) {
    if (cursor >= nibbles.length) return undefined;
    return { child: node[nibbles[cursor]!]!, cursor: cursor + 1, leaf: false };
  }
  if (node.length !== 2) return undefined;
  const compactPath = compactPathNibbles(node[0]);
  if (!compactPath) return undefined;
  if (!compactPath.nibbles.every((nibble, offset) => nibbles[cursor + offset] === nibble)) {
    return undefined;
  }
  return {
    child: compactPath.leaf ? undefined : node[1],
    cursor: cursor + compactPath.nibbles.length,
    leaf: compactPath.leaf,
  };
}

function compactPathNibbles(value: unknown): { leaf: boolean; nibbles: number[] } | undefined {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) return undefined;
  const bytes = hexToBytes(value as Hex);
  if (bytes.length === 0) return undefined;
  const flag = bytes[0]! >> 4;
  if (flag > 3) return undefined;
  const odd = (flag & 1) === 1;
  if (!odd && (bytes[0]! & 0x0f) !== 0) return undefined;
  const nibbles = Array.from(bytes).flatMap((byte) => [byte >> 4, byte & 0x0f]);
  return { leaf: (flag & 2) === 2, nibbles: nibbles.slice(odd ? 1 : 2) };
}

function embeddedNode(item: unknown): { node: ReturnType<typeof fromRlp>; rlp: Hex } | undefined {
  if (Array.isArray(item)) {
    return { node: item as ReturnType<typeof fromRlp>, rlp: toRlp(item) };
  }
  if (typeof item !== "string" || !item.startsWith("0x") || item === "0x") return undefined;
  try {
    const rlp = item as Hex;
    const node = fromRlp(rlp);
    return Array.isArray(node) ? { node, rlp } : undefined;
  } catch {
    return undefined;
  }
}

function tupleValue(value: unknown, key: string, index: number): unknown {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown> & { [index: number]: unknown };
  return record[key] ?? record[index];
}

function l2SequenceFromExtraData(value: unknown): bigint {
  const bytes = normalizeBytes(value, "game extra data");
  if (bytes.length < 32) return 0n;
  return bytesToBigint(bytes.slice(0, 32));
}

function normalizeBigint(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^(?:0x[0-9a-fA-F]+|[0-9]+)$/u.test(value)) return BigInt(value);
  const bytes = normalizeBytes(value, label);
  if (bytes.length !== 32) throw sdkError("CLIENT_ERROR", `${label} must be a U256`, value);
  return bytesToBigint(bytes);
}

function normalizeUnsignedBigint(value: unknown, label: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^(?:0x[0-9a-fA-F]+|[0-9]+)$/u.test(value)) {
    return BigInt(value);
  }
  const bytes = normalizeBytes(value, label);
  if (bytes.length === 0 || bytes.length > 32) {
    throw sdkError("CLIENT_ERROR", `${label} must be an unsigned integer`, value);
  }
  return bytesToBigint(bytes);
}

function normalizeBoolean(value: unknown, label: string): boolean {
  if (typeof value === "boolean") return value;
  const normalized = normalizeUnsignedBigint(value, label);
  if (normalized === 0n) return false;
  if (normalized === 1n) return true;
  throw sdkError("CLIENT_ERROR", `${label} must be a boolean`, value);
}

function normalizeContractId(value: unknown, label: string): string | undefined {
  const contractId = normalizeBytes32(value, label).slice(2);
  return /^0+$/u.test(contractId) ? undefined : contractId;
}

function normalizePositiveBigint(value: bigint | number, label: string): bigint {
  const normalized = typeof value === "bigint" ? value : BigInt(value);
  if (normalized <= 0n) throw sdkError("INVALID_OPERATION", `${label} must be positive`);
  return normalized;
}

function normalizeBytes32(value: unknown, label: string): Hex {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{64}$/u.test(value)) {
    return value.toLowerCase() as Hex;
  }
  const bytes = normalizeBytes(value, label);
  if (bytes.length !== 32) throw sdkError("CLIENT_ERROR", `${label} must be 32 bytes`, value);
  return toHex(bytes);
}

function normalizeAddress(value: unknown, label: string): EvmAddress {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/u.test(value)) {
    return value.toLowerCase() as EvmAddress;
  }
  const bytes = normalizeBytes(value, label);
  if (bytes.length !== 20) throw sdkError("CLIENT_ERROR", `${label} must be 20 bytes`, value);
  return toHex(bytes) as EvmAddress;
}

function normalizeBytes(value: unknown, label: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return Uint8Array.from(value as number[]);
  }
  if (typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) {
    return hexToBytes(value as Hex);
  }
  throw sdkError("CLIENT_ERROR", `${label} is not a byte sequence`, value);
}

function bigintToU256(value: bigint): number[] {
  if (value < 0n || value >= 1n << 256n) {
    throw sdkError("INVALID_OPERATION", "Value does not fit U256");
  }
  return Array.from(hexToBytes(toHex(value, { size: 32 })));
}

function bytesToBigint(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function isZero(value: unknown): boolean {
  try {
    return normalizeBigint(value, "U256") === 0n;
  } catch {
    return false;
  }
}

function requireContractId(value: string, label: string): void {
  if (!value.trim()) throw sdkError("INVALID_OPERATION", `${label} contract id is required`);
}
