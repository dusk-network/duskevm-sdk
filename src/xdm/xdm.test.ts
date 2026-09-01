import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  keccak256,
  toHex,
  toRlp,
  type Hex,
} from "viem";
import {
  L2_TO_L1_MESSAGE_PASSER_ADDRESS,
  L2_CROSS_DOMAIN_MESSENGER_ADDRESS,
  l2CrossDomainMessengerAbi,
  l2ToL1MessagePasserAbi,
  prepareDuskContractCall,
} from "../l2/index.js";
import { DUSK_CONTRACT_CALL_TARGET } from "../envelope/index.js";
import { hashWithdrawal, type WithdrawalTransaction } from "../bridge/index.js";
import {
  appendEmbeddedTerminalNode,
  buildDuskEvmMessageReplayTransaction,
  buildDuskMessageReplayTransaction,
  buildWithdrawalOutputProof,
  createWithdrawalGameReader,
  deliveryState,
  duskEvmDeliveryState,
  duskContractCallLifecycleStatus,
  findWithdrawalProof,
  hashDuskCrossDomainMessage,
  hashDuskEvmCrossDomainMessage,
  observeDuskEvmContractCallStatus,
  parseCrossDomainMessageFromWithdrawal,
  parseSentMessageReceipt,
  readDuskEvmMessageDeliveryState,
  readDuskMessageDeliveryState,
  readWithdrawalPortalState,
  submitDuskContractCall,
  validateDuskEvmDeployment,
  withdrawalStorageKey,
  type CrossDomainMessage,
  type WithdrawalGameReader,
  type WithdrawalProofL2Client,
} from "./index.js";

const SENDER = "0x1111111111111111111111111111111111111111" as const;
const TARGET = "0x2222222222222222222222222222222222222222" as const;
const CONTRACT_ID = `0x${"33".repeat(32)}` as const;
const TX_HASH = `0x${"44".repeat(32)}` as const;
const BLOCK_HASH = `0x${"55".repeat(32)}` as const;
const STATE_ROOT = `0x${"66".repeat(32)}` as const;
const STORAGE_ROOT = `0x${"77".repeat(32)}` as const;
const GAME_PROXY = "0x8888888888888888888888888888888888888888" as const;

const MESSAGE: CrossDomainMessage = {
  nonce: 1n,
  sender: SENDER,
  target: TARGET,
  value: 0n,
  minGasLimit: 150_000n,
  message: "0x1234",
};

describe("cross-domain message helpers", () => {
  it("decodes and hashes the exact relayMessage nested in a withdrawal", () => {
    const data = encodeFunctionData({
      abi: l2CrossDomainMessengerAbi,
      functionName: "relayMessage",
      args: [
        MESSAGE.nonce,
        MESSAGE.sender,
        MESSAGE.target,
        MESSAGE.value,
        MESSAGE.minGasLimit,
        MESSAGE.message,
      ],
    });
    const parsed = parseCrossDomainMessageFromWithdrawal({ data });
    expect(parsed).toEqual(MESSAGE);
    expect(hashDuskCrossDomainMessage(parsed)).toBe(
      keccak256(
        encodeAbiParameters(
          [
            { type: "uint256" },
            { type: "address" },
            { type: "address" },
            { type: "uint256" },
            { type: "uint256" },
            { type: "bytes" },
          ],
          [1n, SENDER, TARGET, 0n, 150_000n, "0x1234"]
        )
      )
    );
    expect(hashDuskEvmCrossDomainMessage(parsed)).toBe(keccak256(data));
  });

  it("parses SentMessage and builds both permissionless replay requests", () => {
    const topics = encodeEventTopics({
      abi: l2CrossDomainMessengerAbi,
      eventName: "SentMessage",
      args: { target: TARGET },
    });
    const data = encodeAbiParameters(
      [
        { type: "address" },
        { type: "bytes" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [SENDER, "0x1234", 1n, 150_000n]
    );
    const parsed = parseSentMessageReceipt(
      {
        logs: [
          {
            address: L2_CROSS_DOMAIN_MESSENGER_ADDRESS,
            topics: topics as readonly Hex[],
            data,
          },
        ],
      },
      L2_CROSS_DOMAIN_MESSENGER_ADDRESS
    );
    expect(parsed).toEqual(MESSAGE);
    expect(() =>
      parseSentMessageReceipt(
        { logs: [{ address: SENDER, topics: topics as readonly Hex[], data }] },
        L2_CROSS_DOMAIN_MESSENGER_ADDRESS
      )
    ).toThrow(/No SentMessage/);

    const duskReplay = buildDuskMessageReplayTransaction({
      messengerContractId: "messenger-id",
      message: parsed,
    });
    expect(duskReplay).toMatchObject({
      contractId: "messenger-id",
      method: "relayMessage",
      metadata: { retry: true, messageHash: hashDuskCrossDomainMessage(MESSAGE) },
    });

    const l2Replay = buildDuskEvmMessageReplayTransaction(parsed);
    expect(l2Replay.to).toBe(L2_CROSS_DOMAIN_MESSENGER_ADDRESS);
    expect(decodeFunctionData({ abi: l2CrossDomainMessengerAbi, data: l2Replay.data })).toMatchObject({
      functionName: "relayMessage",
    });
  });

  it("rejects contradictory delivery flags and marks failures replayable", () => {
    const hash = hashDuskCrossDomainMessage(MESSAGE);
    expect(deliveryState(hash, false, true)).toEqual({
      state: "delivery_failed",
      messageHash: hash,
      replayable: true,
    });
    expect(() => deliveryState(hash, true, true)).toThrow(/both successful and failed/);
    expect(duskEvmDeliveryState(hash, true, true)).toEqual({
      state: "delivered",
      messageHash: hash,
      replayable: false,
    });
  });

  it("queries each Messenger with its direction-specific message identity", async () => {
    const duskHashes: unknown[] = [];
    await readDuskMessageDeliveryState({
      messengerContractId: "messenger-id",
      message: MESSAGE,
      reader: {
        async readContract(request) {
          duskHashes.push(request.args);
          return false;
        },
      },
    });
    expect(duskHashes).toEqual([
      hashDuskCrossDomainMessage(MESSAGE),
      hashDuskCrossDomainMessage(MESSAGE),
    ]);

    const evmHashes: unknown[] = [];
    await readDuskEvmMessageDeliveryState({
      message: MESSAGE,
      client: {
        async readContract(request) {
          evmHashes.push(request.args[0]);
          return false;
        },
      },
    });
    expect(evmHashes).toEqual([
      hashDuskEvmCrossDomainMessage(MESSAGE),
      hashDuskEvmCrossDomainMessage(MESSAGE),
    ]);
  });

  it("treats a successful L2 replay as delivered despite historical failure", async () => {
    await expect(
      readDuskEvmMessageDeliveryState({
        message: MESSAGE,
        client: {
          async readContract() {
            return true;
          },
        },
      })
    ).resolves.toMatchObject({ state: "delivered", replayable: false });
  });
});

describe("withdrawal proof discovery", () => {
  const l2Client: WithdrawalProofL2Client = {
    async getBlock() {
      return { hash: BLOCK_HASH, stateRoot: STATE_ROOT };
    },
    async getProof() {
      return {
        storageHash: STORAGE_ROOT,
        storageProof: [{ proof: ["0xc0"] }],
      };
    },
  };

  it("builds the storage key, output root, and matching game proof", async () => {
    const withdrawalHash = `0x${"99".repeat(32)}` as Hex;
    expect(withdrawalStorageKey(withdrawalHash)).toMatch(/^0x[0-9a-f]{64}$/u);
    const output = await buildWithdrawalOutputProof({
      client: l2Client,
      withdrawalHash,
      blockNumber: 12n,
    });
    const gameReader: WithdrawalGameReader = {
      async respectedGameType() {
        return 8;
      },
      async gameCount() {
        return 1n;
      },
      async latestGames() {
        return [{ index: 0n }];
      },
      async game() {
        return {
          index: 0n,
          gameProxy: GAME_PROXY,
          rootClaim: output.outputRoot,
          l2BlockNumber: 12n,
        };
      },
    };
    await expect(
      findWithdrawalProof({
        l2Client,
        gameReader,
        withdrawalHash,
        withdrawalBlockNumber: 10n,
      })
    ).resolves.toMatchObject({
      disputeGameIndex: 0n,
      disputeGameProxy: GAME_PROXY,
      l2BlockNumber: 12n,
      outputRoot: output.outputRoot,
    });
  });

  it("appends only the inline child selected by the trie key", () => {
    const wrongLeaf = ["0x32", "0xbb"] as readonly Hex[];
    const expectedLeaf = ["0x32", "0xaa"] as readonly Hex[];
    const branch: (Hex | readonly Hex[])[] = Array.from({ length: 17 }, () => "0x" as Hex);
    branch[0] = wrongLeaf;
    branch[1] = expectedLeaf;
    expect(appendEmbeddedTerminalNode("0x12", [toRlp(branch)])).toEqual([
      toRlp(branch),
      toRlp(expectedLeaf),
    ]);
  });

  it("normalizes Dusk driver tuples without exposing them to callers", async () => {
    const calls: string[] = [];
    const reader = createWithdrawalGameReader({
      portalContractId: "portal",
      disputeGameFactoryContractId: "factory",
      reader: {
        async readContract(request) {
          calls.push(request.method);
          switch (request.method) {
            case "respectedGameType":
              return 8;
            case "gameCount":
              return toU256Bytes(1n);
            case "findLatestGames":
              return [{ index: toU256Bytes(0n) }];
            case "gameMetadataAtIndex":
              return [hexBytes(BLOCK_HASH), hexBytes(BLOCK_HASH), toU256Bytes(12n), []];
            case "gameAtIndex":
              return [8, 1, hexBytes(GAME_PROXY)];
            default:
              throw new Error(`unexpected ${request.method}`);
          }
        },
      },
    });
    expect(await reader.respectedGameType()).toBe(8);
    expect(await reader.gameCount()).toBe(1n);
    expect(await reader.latestGames(8, 0n, 1n)).toEqual([{ index: 0n }]);
    expect(await reader.game(0n)).toMatchObject({
      gameProxy: GAME_PROXY,
      rootClaim: BLOCK_HASH,
      l2BlockNumber: 12n,
    });
    expect(calls).toContain("gameMetadataAtIndex");
  });
});

describe("submission and lifecycle", () => {
  const publicClient = {
    async getChainId() {
      return 745;
    },
    async getBytecode() {
      return "0x6000" as Hex;
    },
    async waitForTransactionReceipt() {
      return { status: "success" as const, logs: [] };
    },
  };

  it("fails closed on chain mismatch before wallet submission", async () => {
    const sendTransaction = vi.fn(async () => TX_HASH);
    await expect(
      submitDuskContractCall({
        publicClient,
        sendTransaction,
        expectedChainId: 746,
        targetContractId: CONTRACT_ID,
        payload: "0x1234",
      })
    ).rejects.toThrow(/chain mismatch/);
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("submits after validating the canonical Messenger deployment", async () => {
    await expect(
      submitDuskContractCall({
        publicClient,
        sendTransaction: async (transaction) => {
          expect(transaction.to).toBe(L2_CROSS_DOMAIN_MESSENGER_ADDRESS);
          return TX_HASH;
        },
        expectedChainId: 745,
        targetContractId: CONTRACT_ID,
        payload: "0x1234",
      })
    ).resolves.toMatchObject({ transactionHash: TX_HASH });
    await expect(
      validateDuskEvmDeployment({ client: publicClient, expectedChainId: 745 })
    ).resolves.toMatchObject({ chainId: 745 });
  });

  it("binds confirmation to the prepared Dusk call instead of the first withdrawal", async () => {
    const prepared = prepareDuskContractCall({
      targetContractId: CONTRACT_ID,
      payload: "0x1234",
    });
    const unrelated = preparedMessagePassedLog({
      ...prepared,
      envelopeHex: "0xabcd",
    });
    const matching = preparedMessagePassedLog(prepared);
    const waitingClient = {
      ...publicClient,
      async waitForTransactionReceipt() {
        return { status: "success" as const, logs: [unrelated, matching] };
      },
    };
    await expect(
      submitDuskContractCall({
        publicClient: waitingClient,
        sendTransaction: async () => TX_HASH,
        expectedChainId: 745,
        targetContractId: CONTRACT_ID,
        payload: "0x1234",
        l1MessengerAddress: TARGET,
        wait: true,
      })
    ).resolves.toMatchObject({
      transactionHash: TX_HASH,
      withdrawal: { withdrawal: { sender: L2_CROSS_DOMAIN_MESSENGER_ADDRESS, target: TARGET } },
      crossDomainMessage: {
        target: DUSK_CONTRACT_CALL_TARGET,
        message: prepared.envelopeHex,
      },
    });
  });

  it("rejects receipts with no unique prepared-intent match", async () => {
    const prepared = prepareDuskContractCall({
      targetContractId: CONTRACT_ID,
      payload: "0x1234",
    });
    const submit = (logs: ReturnType<typeof preparedMessagePassedLog>[]) =>
      submitDuskContractCall({
        publicClient: {
          ...publicClient,
          async waitForTransactionReceipt() {
            return { status: "success" as const, logs };
          },
        },
        sendTransaction: async () => TX_HASH,
        expectedChainId: 745,
        targetContractId: CONTRACT_ID,
        payload: "0x1234",
        l1MessengerAddress: TARGET,
        wait: true,
      });
    await expect(submit([preparedMessagePassedLog({ ...prepared, envelopeHex: "0xabcd" })]))
      .rejects.toThrow(/matching the prepared Dusk call/);
    const matching = preparedMessagePassedLog(prepared);
    await expect(submit([matching, matching])).rejects.toThrow(/more than one/);
    await expect(
      submit([{ ...matching, transactionHash: `0x${"aa".repeat(32)}` }])
    ).rejects.toThrow(/matching the prepared Dusk call/);
  });

  it("resolves the native Dusk submission to its projected Ethereum receipt", async () => {
    const projectedHash = `0x${"aa".repeat(32)}` as Hex;
    const requestedReceipts: Hex[] = [];
    const l1Client = {
      async request(request: { params: readonly [Hex] }) {
        expect(request.params).toEqual([TX_HASH]);
        return projectedHash;
      },
      async getTransactionReceipt({ hash }: { hash: Hex }) {
        requestedReceipts.push(hash);
        const error = new Error("not found");
        error.name = "TransactionReceiptNotFoundError";
        throw error;
      },
    };
    await expect(
      observeDuskEvmContractCallStatus({
        l1Client,
        l2Client: { ...publicClient, getTransactionReceipt: l1Client.getTransactionReceipt },
        duskTransactionHash: TX_HASH,
        expectedChainId: 745,
      })
    ).resolves.toMatchObject({
      phase: "submitted",
      metadata: {
        duskTransactionHash: TX_HASH,
        l1TransactionHash: projectedHash,
        stage: "l1_pending",
      },
    });
    expect(requestedReceipts).toEqual([projectedHash]);
  });

  it("surfaces finalized delivery failures as replayable", () => {
    const messageHash = hashDuskCrossDomainMessage(MESSAGE);
    expect(
      duskContractCallLifecycleStatus({
        l2TransactionHash: TX_HASH,
        portalFinalized: true,
        delivery: { state: "delivery_failed", messageHash, replayable: true },
        now: () => 7,
      })
    ).toEqual({
      phase: "accepted",
      updatedAt: 7,
      message: "The native receiver rejected the message; the exact message can be replayed",
      metadata: {
        stage: "delivery_failed",
        l2TransactionHash: TX_HASH,
        messageHash,
        replayable: true,
      },
    });
    expect(
      duskContractCallLifecycleStatus({
        replayReceipt: { transactionHash: TX_HASH, success: false },
        now: () => 8,
      })
    ).toMatchObject({
      phase: "accepted",
      metadata: { stage: "delivery_failed", replayable: true },
    });
    expect(
      duskContractCallLifecycleStatus({
        replayReceipt: { transactionHash: TX_HASH, success: true, finalized: true },
        delivery: { state: "delivery_failed", messageHash, replayable: true },
        now: () => 9,
      })
    ).toMatchObject({
      phase: "accepted",
      metadata: { stage: "delivery_failed", replayable: true },
    });
  });

  it("does not call a successful but non-finalized L1 transaction finalized", () => {
    expect(
      duskContractCallLifecycleStatus({
        finalizeReceipt: { transactionHash: TX_HASH, success: true, finalized: false },
        now: () => 10,
      })
    ).toMatchObject({ phase: "accepted", metadata: { stage: "finalize_submitted" } });
    expect(
      duskContractCallLifecycleStatus({
        finalizeReceipt: { transactionHash: TX_HASH, success: true, finalized: true },
        now: () => 11,
      })
    ).toMatchObject({ phase: "accepted", metadata: { stage: "finalized" } });
  });

  it("tracks Portal proof maturity and authoritative finalizability", async () => {
    const withdrawalHash = `0x${"99".repeat(32)}` as Hex;
    const methods: string[] = [];
    const reader = {
      async readContract(request: { method: string }) {
        methods.push(request.method);
        if (request.method === "finalizedWithdrawals") return false;
        if (request.method === "provenWithdrawals") return [GAME_PROXY, 100n];
        if (request.method === "proofMaturityDelaySeconds") return 30n;
        if (request.method === "paused") return false;
        if (request.method === "checkWithdrawal") return null;
        throw new Error(`unexpected ${request.method}`);
      },
    };
    await expect(
      readWithdrawalPortalState({
        reader,
        portalContractId: "portal",
        withdrawalHash,
        proofSubmitter: SENDER,
        latestL1Timestamp: 129n,
      })
    ).resolves.toMatchObject({ state: "proven_waiting", readyAt: 131n });
    await expect(
      readWithdrawalPortalState({
        reader,
        portalContractId: "portal",
        withdrawalHash,
        proofSubmitter: SENDER,
        latestL1Timestamp: 130n,
      })
    ).resolves.toMatchObject({ state: "proven_waiting", finalizable: false, readyAt: 131n });
    await expect(
      readWithdrawalPortalState({
        reader,
        portalContractId: "portal",
        withdrawalHash,
        proofSubmitter: SENDER,
        latestL1Timestamp: 131n,
      })
    ).resolves.toMatchObject({ state: "finalizable", finalizable: true, readyAt: 131n });
    expect(methods).toContain("checkWithdrawal");
  });

  it("does not advertise finalization while the Portal is paused", async () => {
    const withdrawalHash = `0x${"99".repeat(32)}` as Hex;
    await expect(
      readWithdrawalPortalState({
        reader: {
          async readContract(request) {
            if (request.method === "finalizedWithdrawals") return false;
            if (request.method === "provenWithdrawals") return [GAME_PROXY, 100n];
            if (request.method === "proofMaturityDelaySeconds") return 30n;
            if (request.method === "paused") return true;
            throw new Error(`unexpected ${request.method}`);
          },
        },
        portalContractId: "portal",
        withdrawalHash,
        proofSubmitter: SENDER,
        latestL1Timestamp: 131n,
      })
    ).resolves.toMatchObject({
      state: "proven_waiting",
      finalizable: false,
      reason: "OptimismPortal is paused",
    });
  });
});

function preparedMessagePassedLog(prepared: {
  envelopeHex: Hex;
  minGasLimit: number;
}): {
  address: typeof L2_TO_L1_MESSAGE_PASSER_ADDRESS;
  topics: readonly Hex[];
  data: Hex;
  transactionHash?: Hex;
} {
  const relayData = encodeFunctionData({
    abi: l2CrossDomainMessengerAbi,
    functionName: "relayMessage",
    args: [1n, SENDER, DUSK_CONTRACT_CALL_TARGET, 0n, BigInt(prepared.minGasLimit), prepared.envelopeHex],
  });
  const withdrawal: WithdrawalTransaction = {
    nonce: 2n,
    sender: L2_CROSS_DOMAIN_MESSENGER_ADDRESS,
    target: TARGET,
    value: 0n,
    gasLimit: 300_000n,
    data: relayData,
  };
  return {
    address: L2_TO_L1_MESSAGE_PASSER_ADDRESS,
    topics: encodeEventTopics({
      abi: l2ToL1MessagePasserAbi,
      eventName: "MessagePassed",
      args: {
        nonce: withdrawal.nonce,
        sender: withdrawal.sender,
        target: withdrawal.target,
      },
    }) as readonly Hex[],
    data: encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes" },
        { type: "bytes32" },
      ],
      [withdrawal.value, withdrawal.gasLimit, withdrawal.data, hashWithdrawal(withdrawal)]
    ),
  };
}

function toU256Bytes(value: bigint): number[] {
  return Array.from(hexBytes(toHex(value, { size: 32 })));
}

function hexBytes(value: Hex): Uint8Array {
  return Uint8Array.from(Buffer.from(value.slice(2), "hex"));
}
