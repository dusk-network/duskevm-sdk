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
    storageProof: readonly {
      key: Hex;
      value: bigint;
      proof: readonly Hex[];
    }[];
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
  gameCount(): Promise<bigint>;
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
}): WithdrawalGameReader {
  requireContractId(params.portalContractId, "OptimismPortal");
  if (typeof params.reader?.readContract !== "function") {
    throw sdkError("UNSUPPORTED", "Proof discovery requires a Dusk L1 readContract adapter");
  }
  const read = params.reader.readContract.bind(params.reader);
  let canonicalContractIds:
    | Promise<{ anchorStateRegistryContractId: string; disputeGameFactoryContractId: string }>
    | undefined;
  const resolveCanonicalContractIds = () => {
    canonicalContractIds ??= Promise.all([
      read({
        contractId: params.portalContractId,
        method: portalMethods.anchorStateRegistryContractId.name,
      }),
      read({
        contractId: params.portalContractId,
        method: portalMethods.disputeGameFactoryContractId.name,
      }),
    ])
      .then(([anchorStateRegistryId, disputeGameFactoryId]) => ({
        anchorStateRegistryContractId: requireResolvedContractId(
          anchorStateRegistryId,
          "AnchorStateRegistry contract id"
        ),
        disputeGameFactoryContractId: requireResolvedContractId(
          disputeGameFactoryId,
          "DisputeGameFactory contract id"
        ),
      }))
      .catch((error: unknown) => {
        canonicalContractIds = undefined;
        throw error;
      });
    return canonicalContractIds;
  };

  return {
    async gameCount() {
      const { disputeGameFactoryContractId } = await resolveCanonicalContractIds();
      return normalizeBigint(
        await read({
          contractId: disputeGameFactoryContractId,
          method: gameFactoryMethods.gameCount.name,
        }),
        "game count"
      );
    },
    async game(index) {
      const { disputeGameFactoryContractId } = await resolveCanonicalContractIds();
      const [metadata, gameAtIndex] = await Promise.all([
        read({
          contractId: disputeGameFactoryContractId,
          method: gameFactoryMethods.gameMetadataAtIndex.name,
          args: bigintToU256(index),
        }),
        read({
          contractId: disputeGameFactoryContractId,
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
      const { anchorStateRegistryContractId, disputeGameFactoryContractId } =
        await resolveCanonicalContractIds();
      const gameContractId = await read({
        contractId: disputeGameFactoryContractId,
        method: gameFactoryMethods.gameContractId.name,
        args: game.gameProxy,
      });
      const resolvedGameContractId = normalizeContractId(
        gameContractId,
        "dispute game contract id"
      );
      if (!resolvedGameContractId) return false;

      const [proper, respected, status] = await Promise.all([
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
          contractId: resolvedGameContractId,
          method: duskL1ContractMethods.faultDisputeGameHub.statusForGame.name,
          args: game.gameProxy,
        }),
      ]);
      return (
        normalizeBoolean(proper, "isGameProper") &&
        normalizeBoolean(respected, "isGameRespected") &&
        normalizeUnsignedBigint(status, "game status") !== CHALLENGER_WINS
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
  const gameCount = await params.gameReader.gameCount();
  if (gameCount === 0n) {
    throw sdkError("UNAVAILABLE", "No dispute games have been proposed yet");
  }

  let index = gameCount;
  let remaining = maxGames;
  let lastError: unknown;

  while (remaining > 0n && index > 0n) {
    index -= 1n;
    remaining -= 1n;
    try {
      const game = await params.gameReader.game(index);
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
  if (normalizeBytes32(storageProof.key, "withdrawal storage proof key") !== storageKey) {
    throw sdkError("CLIENT_ERROR", "Withdrawal storage proof is for a different storage key");
  }
  if (normalizeUnsignedBigint(storageProof.value, "withdrawal storage value") !== 1n) {
    throw sdkError("UNAVAILABLE", "Withdrawal is not present in the committed message passer state");
  }
  if (storageProof.proof.length === 0) {
    throw sdkError("UNAVAILABLE", "Withdrawal storage proof is empty");
  }

  const outputRootProof: OutputRootProof = {
    version: ZERO_HASH,
    stateRoot: normalizeBytes32(block.stateRoot, "L2 state root"),
    messagePasserStorageRoot: normalizeBytes32(
      accountProof.storageHash,
      "message passer storage root"
    ),
    latestBlockhash: normalizeBytes32(block.hash, "L2 block hash"),
  };
  const withdrawalProof = verifyStorageInclusion(
    outputRootProof.messagePasserStorageRoot,
    keccak256(storageKey),
    storageProof.proof
  );
  return {
    outputRoot: hashOutputRootProof(outputRootProof),
    outputRootProof,
    withdrawalProof,
  };
}

function verifyStorageInclusion(
  storageRoot: Hex,
  trieKey: Hex,
  proof: readonly Hex[]
): readonly Hex[] {
  const normalizedProof = appendEmbeddedTerminalNode(trieKey, proof);
  const nibbles = Array.from(hexToBytes(trieKey)).flatMap((byte) => [byte >> 4, byte & 0x0f]);
  let cursor = 0;
  let expected: { kind: "hash" | "inline"; value: Hex } = {
    kind: "hash",
    value: normalizeBytes32(storageRoot, "message passer storage root"),
  };

  for (let index = 0; index < normalizedProof.length; index += 1) {
    const encoded = normalizeNodeHex(normalizedProof[index]);
    if (
      (expected.kind === "hash" && keccak256(encoded) !== expected.value) ||
      (expected.kind === "inline" && encoded !== expected.value)
    ) {
      throw sdkError("CLIENT_ERROR", "Withdrawal storage proof does not link to its storage root");
    }

    let node: ReturnType<typeof fromRlp>;
    try {
      node = fromRlp(encoded);
    } catch (error) {
      throw sdkError("CLIENT_ERROR", "Withdrawal storage proof contains malformed RLP", error);
    }
    if (!Array.isArray(node) || toRlp(node) !== encoded) {
      throw sdkError("CLIENT_ERROR", "Withdrawal storage proof contains a non-canonical trie node");
    }

    if (node.length === 17) {
      if (cursor === nibbles.length) {
        requireTerminalStorageValue(node[16], index, normalizedProof.length);
        return normalizedProof;
      }
      expected = requireTrieChild(node[nibbles[cursor]!]!);
      cursor += 1;
      continue;
    }

    if (node.length !== 2) {
      throw sdkError("CLIENT_ERROR", "Withdrawal storage proof contains an invalid trie node");
    }
    const path = compactPathNibbles(node[0]);
    if (
      !path ||
      !path.nibbles.every((nibble, offset) => nibbles[cursor + offset] === nibble)
    ) {
      throw sdkError("UNAVAILABLE", "Withdrawal storage proof does not include the requested key");
    }
    cursor += path.nibbles.length;
    if (path.leaf) {
      if (cursor !== nibbles.length) {
        throw sdkError("UNAVAILABLE", "Withdrawal storage proof terminates at a different key");
      }
      requireTerminalStorageValue(node[1], index, normalizedProof.length);
      return normalizedProof;
    }
    expected = requireTrieChild(node[1]);
  }

  throw sdkError("UNAVAILABLE", "Withdrawal storage proof does not contain a terminal value");
}

function requireTrieChild(value: unknown): { kind: "hash" | "inline"; value: Hex } {
  if (Array.isArray(value)) {
    const encoded = toRlp(value);
    if (hexToBytes(encoded).length >= 32) {
      throw sdkError("CLIENT_ERROR", "Withdrawal storage proof embeds an oversized trie node");
    }
    return { kind: "inline", value: encoded };
  }
  if (typeof value === "string" && /^0x[0-9a-fA-F]{64}$/u.test(value)) {
    return { kind: "hash", value: value.toLowerCase() as Hex };
  }
  throw sdkError("UNAVAILABLE", "Withdrawal storage proof follows an absent trie child");
}

function requireTerminalStorageValue(value: unknown, index: number, proofLength: number): void {
  if (index !== proofLength - 1) {
    throw sdkError("CLIENT_ERROR", "Withdrawal storage proof contains trailing trie nodes");
  }
  if (typeof value !== "string" || value.toLowerCase() !== "0x01") {
    throw sdkError("UNAVAILABLE", "Withdrawal storage proof terminal value is not 0x01");
  }
}

function normalizeNodeHex(value: Hex | undefined): Hex {
  if (!value || !/^0x(?:[0-9a-fA-F]{2})+$/u.test(value)) {
    throw sdkError("CLIENT_ERROR", "Withdrawal storage proof contains an invalid node encoding");
  }
  return value.toLowerCase() as Hex;
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

function requireResolvedContractId(value: unknown, label: string): string {
  const contractId = normalizeContractId(value, label);
  if (!contractId) throw sdkError("UNAVAILABLE", `${label} is not configured`);
  return contractId;
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
