import { encodeAbiParameters, encodeEventTopics } from "viem";
import { createBridgeClient } from "./client.js";
import {
  duskContractIdToEvmAddress,
  encodeDuskContractAssetRecipient,
  encodeDuskNativeContractCredit,
} from "./asset-recipient.js";
import {
  MESSAGE_PASSED_EVENT_TOPIC,
  buildFinalizeWithdrawalTransaction,
  buildProveWithdrawalTransaction,
  hashWithdrawal,
  parseMessagePassedReceipt,
  prepareDrc20Withdrawal,
  prepareDrc721Withdrawal,
  prepareNativeContractCreditWithdrawal,
  prepareNativeWithdrawal,
  serializeOutputRootProofForDuskAbi,
  serializeWithdrawalForDuskAbi,
  submitFinalizeWithdrawalTransaction,
  submitProveWithdrawalTransaction,
  withdrawalLifecycleStatus,
  type OutputRootProof,
  type WithdrawalProofData,
  type WithdrawalTransaction,
} from "./withdrawal.js";
import {
  L2_TO_L1_MESSAGE_PASSER_ADDRESS,
  l2ToL1MessagePasserAbi,
} from "../l2/index.js";

const RECIPIENT = "0x1111111111111111111111111111111111111111" as const;
const SENDER = "0x2222222222222222222222222222222222222222" as const;
const TARGET = "0x3333333333333333333333333333333333333333" as const;
const L1_TOKEN = "0x4444444444444444444444444444444444444444" as const;
const L2_TOKEN = "0x5555555555555555555555555555555555555555" as const;
const DUSK_CONTRACT_ID = `0x${"66".repeat(32)}` as const;
const DUSK_ASSET_RECIPIENT = encodeDuskContractAssetRecipient(DUSK_CONTRACT_ID);
const DUSK_NATIVE_RECIPIENT = encodeDuskNativeContractCredit(DUSK_CONTRACT_ID);
const DUSK_NATIVE_EVM_RECIPIENT = duskContractIdToEvmAddress(DUSK_CONTRACT_ID);
const DUSK_NATIVE_AMOUNT_WEI = 1_000_000_000n;

describe("withdrawal helpers", () => {
  it("prepares native, DRC20, and DRC721 L2 withdrawal operations", () => {
    const native = prepareNativeWithdrawal({
      recipient: DUSK_NATIVE_EVM_RECIPIENT,
      amountWei: DUSK_NATIVE_AMOUNT_WEI,
      extraData: DUSK_NATIVE_RECIPIENT,
    });
    const drc20 = prepareDrc20Withdrawal({
      recipient: RECIPIENT,
      l1Token: L1_TOKEN,
      l2Token: L2_TOKEN,
      amount: 11n,
      extraData: DUSK_ASSET_RECIPIENT,
    });
    const drc20WithoutL1Token = prepareDrc20Withdrawal({
      recipient: RECIPIENT,
      l2Token: L2_TOKEN,
      amount: 11n,
      extraData: DUSK_ASSET_RECIPIENT,
    });
    const drc721 = prepareDrc721Withdrawal({
      recipient: RECIPIENT,
      l1Token: L1_TOKEN,
      l2Token: L2_TOKEN,
      tokenId: 12n,
      extraData: DUSK_ASSET_RECIPIENT,
    });

    expect(native.direction).toBe("l2-to-l1");
    expect(native.asset).toEqual({ kind: "native", amountWei: DUSK_NATIVE_AMOUNT_WEI });
    expect(native.l2Transaction.value).toBe(DUSK_NATIVE_AMOUNT_WEI);
    expect(native.extraData).toBe(`0x2001${"66".repeat(32)}`);
    expect(drc20.asset).toEqual({
      kind: "drc20",
      l1Token: L1_TOKEN,
      l2Token: L2_TOKEN,
      amount: 11n,
    });
    expect(drc721.asset).toEqual({
      kind: "drc721",
      l1Token: L1_TOKEN,
      l2Token: L2_TOKEN,
      tokenId: 12n,
    });
    expect(native.id).toMatch(/^withdrawal:0x[0-9a-f]{64}$/);
    expect(native.id).not.toBe(drc20.id);
    expect(drc20.id).toBe(drc20WithoutL1Token.id);
  });

  it("derives native contract-credit recipients and rejects ambiguous low-level inputs", () => {
    const prepared = prepareNativeContractCreditWithdrawal({
      targetContractId: DUSK_CONTRACT_ID,
      amountWei: DUSK_NATIVE_AMOUNT_WEI,
      payload: "0x1234",
    });
    expect(prepared.recipient).toBe(DUSK_NATIVE_EVM_RECIPIENT);
    expect(prepared.extraData).toBe(`0x2001${"66".repeat(32)}1234`);

    expect(() =>
      prepareNativeWithdrawal({
        recipient: RECIPIENT,
        amountWei: DUSK_NATIVE_AMOUNT_WEI,
        extraData: DUSK_NATIVE_RECIPIENT,
      })
    ).toThrow(/recipient must match the target ContractId/);

    expect(() =>
      prepareNativeContractCreditWithdrawal({
        targetContractId: DUSK_CONTRACT_ID,
        amountWei: 1n,
      })
    ).toThrow(/must convert to exact Lux/);

    expect(() =>
      prepareNativeContractCreditWithdrawal({
        targetContractId: DUSK_CONTRACT_ID,
        amountWei: (1n << 64n) * DUSK_NATIVE_AMOUNT_WEI,
      })
    ).toThrow(/exceeds the Dusk u64 Lux limit/);
  });

  it("canonicalizes withdrawal addresses and DRC721 token IDs for operation identity", () => {
    const uppercaseRecipient = RECIPIENT.toUpperCase() as typeof RECIPIENT;
    const uppercaseL1Token = L1_TOKEN.toUpperCase() as typeof L1_TOKEN;
    const uppercaseL2Token = L2_TOKEN.toUpperCase() as typeof L2_TOKEN;
    const canonicalDrc20 = prepareDrc20Withdrawal({
      recipient: RECIPIENT,
      l1Token: L1_TOKEN,
      l2Token: L2_TOKEN,
      amount: 11n,
      extraData: DUSK_ASSET_RECIPIENT,
    });
    const uppercaseDrc20 = prepareDrc20Withdrawal({
      recipient: uppercaseRecipient,
      l1Token: uppercaseL1Token,
      l2Token: uppercaseL2Token,
      amount: 11n,
      extraData: DUSK_ASSET_RECIPIENT,
    });
    const canonicalDrc721 = prepareDrc721Withdrawal({
      recipient: RECIPIENT,
      l1Token: L1_TOKEN,
      l2Token: L2_TOKEN,
      tokenId: 1n,
      extraData: DUSK_ASSET_RECIPIENT,
    });
    const hexDrc721 = prepareDrc721Withdrawal({
      recipient: uppercaseRecipient,
      l1Token: uppercaseL1Token,
      l2Token: uppercaseL2Token,
      tokenId: "0X01",
      extraData: DUSK_ASSET_RECIPIENT,
    });

    expect(uppercaseDrc20.id).toBe(canonicalDrc20.id);
    expect(uppercaseDrc20.asset).toEqual(canonicalDrc20.asset);
    expect(uppercaseDrc20.recipient).toBe(RECIPIENT);
    expect(uppercaseDrc20.l2Transaction).toEqual(canonicalDrc20.l2Transaction);
    expect(hexDrc721.id).toBe(canonicalDrc721.id);
    expect(hexDrc721.asset).toEqual(canonicalDrc721.asset);
    expect(hexDrc721.recipient).toBe(RECIPIENT);
    expect(hexDrc721.l2Transaction).toEqual(canonicalDrc721.l2Transaction);
  });

  it("rejects malformed withdrawal EVM addresses as SDK operation errors", () => {
    const prepareInvalidRecipient = () =>
      prepareNativeWithdrawal({
        recipient: "0x1234" as never,
        amountWei: DUSK_NATIVE_AMOUNT_WEI,
        extraData: DUSK_NATIVE_RECIPIENT,
      });
    const prepareInvalidToken = () =>
      prepareDrc721Withdrawal({
        recipient: RECIPIENT,
        l1Token: "not-an-address" as never,
        l2Token: L2_TOKEN,
        tokenId: 1n,
        extraData: DUSK_ASSET_RECIPIENT,
      });

    expect(prepareInvalidRecipient).toThrow(/Withdrawal recipient must be a 20-byte/);
    expect(prepareInvalidToken).toThrow(/Withdrawal L1 token must be a 20-byte/);
    try {
      prepareInvalidToken();
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_OPERATION" });
    }
  });

  it("rejects withdrawal amounts outside uint256", () => {
    expect(() =>
      prepareNativeWithdrawal({
        recipient: DUSK_NATIVE_EVM_RECIPIENT,
        amountWei: -1n,
        extraData: DUSK_NATIVE_RECIPIENT,
      })
    ).toThrow(/native amount does not fit uint256/);

    expect(() =>
      prepareDrc20Withdrawal({
        recipient: RECIPIENT,
        l2Token: L2_TOKEN,
        amount: 1n << 256n,
        extraData: DUSK_ASSET_RECIPIENT,
      })
    ).toThrow(/DRC20 amount does not fit uint256/);
  });

  it("rejects missing, legacy, and contract-incompatible recipient metadata", () => {
    expect(() =>
      prepareNativeWithdrawal({
        recipient: RECIPIENT,
        amountWei: DUSK_NATIVE_AMOUNT_WEI,
        delivery: { target: { kind: "bls", value: "legacy" }, payload: "0x" },
      } as never)
    ).toThrow(/deposit envelopes are not withdrawal recipients/);

    expect(() =>
      prepareNativeWithdrawal({
        recipient: RECIPIENT,
        amountWei: 10n,
        extraData: DUSK_NATIVE_RECIPIENT,
        delivery: { target: { kind: "bls", value: "legacy" }, payload: "0x" },
      } as never)
    ).toThrow(/deposit envelopes are not withdrawal recipients/);

    expect(() =>
      prepareNativeWithdrawal({
        recipient: RECIPIENT,
        amountWei: 10n,
        extraData: DUSK_ASSET_RECIPIENT,
      })
    ).toThrow(/must be an external account or native contract credit/);

    expect(() =>
      prepareDrc20Withdrawal({
        recipient: RECIPIENT,
        l2Token: L2_TOKEN,
        amount: 10n,
        extraData: DUSK_NATIVE_RECIPIENT,
      })
    ).toThrow(/unsupported tag or version/);

    expect(() =>
      prepareDrc721Withdrawal({
        recipient: RECIPIENT,
        l1Token: L1_TOKEN,
        l2Token: L2_TOKEN,
        tokenId: 1n,
      } as never)
    ).toThrow(/recipient extraData is required/);
  });

  it("exposes withdrawal preparation through the bridge client", () => {
    const bridge = createBridgeClient();
    const withdrawal = bridge.prepareNativeWithdrawal({
      recipient: DUSK_NATIVE_EVM_RECIPIENT,
      amountWei: DUSK_NATIVE_AMOUNT_WEI,
      extraData: DUSK_NATIVE_RECIPIENT,
    });

    expect(withdrawal.direction).toBe("l2-to-l1");
    expect(withdrawal.metadata).toMatchObject({
      recipient: DUSK_NATIVE_EVM_RECIPIENT,
      minGasLimit: 200_000,
      extraData: DUSK_NATIVE_RECIPIENT,
    });
  });

  it("parses MessagePassed logs and verifies the withdrawal hash", () => {
    const withdrawal = sampleWithdrawal();
    const receipt = {
      blockNumber: "0X7B",
      transactionHash: "0xl2",
      logs: [
        {
          ...messagePassedLog(withdrawal),
          logIndex: "0X03",
        },
      ],
    };

    expect(receipt.logs[0]?.topics[0]).toBe(MESSAGE_PASSED_EVENT_TOPIC);
    const parsed = parseMessagePassedReceipt(receipt);

    expect(parsed.withdrawal).toEqual(withdrawal);
    expect(parsed.withdrawalHash).toBe(hashWithdrawal(withdrawal));
    expect(parsed.blockNumber).toBe(123n);
    expect(parsed.transactionHash).toBe("0xl2");
    expect(parsed.logIndex).toBe(3);
  });

  it("fails when a MessagePassed log carries an inconsistent withdrawal hash", () => {
    const withdrawal = sampleWithdrawal();
    const log = messagePassedLog(withdrawal, `0x${"12".repeat(32)}`);

    expect(() => parseMessagePassedReceipt({ logs: [log] })).toThrow(/does not match/);
  });

  it("wraps malformed MessagePassed decode failures as SDK operation errors", () => {
    const parse = () =>
      parseMessagePassedReceipt({
        logs: [
          {
            address: L2_TO_L1_MESSAGE_PASSER_ADDRESS,
            topics: [MESSAGE_PASSED_EVENT_TOPIC],
            data: "0x12",
          },
        ],
      });

    expect(parse).toThrow(/MessagePassed log could not be decoded/);
    try {
      parse();
    } catch (error) {
      expect(error).toMatchObject({
        code: "INVALID_OPERATION",
        cause: expect.any(Error),
      });
    }
  });

  it("serializes portal prove and finalize calls as Dusk contract requests", () => {
    const withdrawal = sampleWithdrawal();
    const proof = sampleProof();

    expect(serializeWithdrawalForDuskAbi(withdrawal)).toEqual({
      nonce: `0x${"00".repeat(31)}01`,
      sender: SENDER,
      target: TARGET,
      value: `0x${"00".repeat(31)}05`,
      gas_limit: `0x${"00".repeat(29)}030d40`,
      data: "0x1234",
    });
    expect(serializeOutputRootProofForDuskAbi(proof.outputRootProof)).toEqual({
      version: `0x${"00".repeat(32)}`,
      state_root: `0x${"11".repeat(32)}`,
      message_passer_storage_root: `0x${"22".repeat(32)}`,
      latest_blockhash: `0x${"33".repeat(32)}`,
    });

    expect(
      buildProveWithdrawalTransaction({
        portalContractId: "portal",
        withdrawal,
        ...proof,
        disputeGameIndex: "0X07",
        gasLimit: 1_000_000n,
      })
    ).toMatchObject({
      kind: "contract_call",
      contractId: "portal",
      method: "proveWithdrawalTransaction",
      gasLimit: 1_000_000n,
      args: [
        serializeWithdrawalForDuskAbi(withdrawal),
        `0x${"00".repeat(31)}07`,
        serializeOutputRootProofForDuskAbi(proof.outputRootProof),
        ["0xabcd"],
      ],
      metadata: {
        bridgeDirection: "l2-to-l1",
        withdrawalHash: hashWithdrawal(withdrawal),
      },
    });

    expect(
      buildFinalizeWithdrawalTransaction({
        portalContractId: "portal",
        withdrawal,
        proofSubmitter: RECIPIENT,
      })
    ).toMatchObject({
      kind: "contract_call",
      contractId: "portal",
      method: "finalizeWithdrawalTransactionExternalProof",
      args: [serializeWithdrawalForDuskAbi(withdrawal), RECIPIENT],
    });
  });

  it("rejects malformed portal proof and withdrawal request fields", () => {
    const withdrawal = sampleWithdrawal();
    const proof = sampleProof();

    expect(() =>
      buildProveWithdrawalTransaction({
        portalContractId: "portal",
        withdrawal,
        ...proof,
        outputRootProof: {
          ...proof.outputRootProof,
          stateRoot: "0x1234",
        },
      })
    ).toThrow(/stateRoot must be 32 bytes/);

    expect(() =>
      buildProveWithdrawalTransaction({
        portalContractId: "portal",
        withdrawal,
        ...proof,
        withdrawalProof: ["0xabc" as `0x${string}`],
      })
    ).toThrow(/withdrawal proof node must be 0x-prefixed byte hex/);

    expect(() =>
      buildFinalizeWithdrawalTransaction({
        portalContractId: "portal",
        withdrawal: {
          ...withdrawal,
          data: "0xabc" as `0x${string}`,
        },
      })
    ).toThrow(/withdrawal data must be 0x-prefixed byte hex/);

    expect(() =>
      buildProveWithdrawalTransaction({
        portalContractId: "portal",
        withdrawal: {
          ...withdrawal,
          sender: "0x1234" as never,
        },
        ...proof,
      })
    ).toThrow(/withdrawal sender must be a 20-byte/);

    expect(() =>
      serializeWithdrawalForDuskAbi({
        ...withdrawal,
        target: "not-an-address" as never,
      })
    ).toThrow(/withdrawal target must be a 20-byte/);

    expect(() =>
      buildFinalizeWithdrawalTransaction({
        portalContractId: "portal",
        withdrawal,
        proofSubmitter: "0x1234" as never,
      })
    ).toThrow(/withdrawal proof submitter must be a 20-byte/);

    expect(() =>
      prepareNativeWithdrawal({
        recipient: RECIPIENT,
        amountWei: 1n,
        minGasLimit: 0x1_0000_0000,
        extraData: DUSK_NATIVE_RECIPIENT,
      })
    ).toThrow(/minGasLimit must be a uint32/);
  });

  it("submits prove and finalize requests through the Dusk L1 helper", async () => {
    const sent: unknown[] = [];
    const client = {
      async submitTransaction(request: unknown) {
        sent.push(request);
        return { transactionHash: `tx-${sent.length}` };
      },
      async getGasPriceLux() {
        return 1n;
      },
    };
    const withdrawal = sampleWithdrawal();

    await expect(
      submitProveWithdrawalTransaction(client, {
        portalContractId: "portal",
        withdrawal,
        ...sampleProof(),
      })
    ).resolves.toMatchObject({ submitted: { transactionHash: "tx-1" } });
    await expect(
      submitFinalizeWithdrawalTransaction(client, {
        portalContractId: "portal",
        withdrawal,
      })
    ).resolves.toMatchObject({ submitted: { transactionHash: "tx-2" } });
    expect(sent).toHaveLength(2);
  });

  it("reports withdrawal lifecycle not-ready, prove-ready, finalized, and failed paths", () => {
    const operation = prepareNativeWithdrawal({
      recipient: DUSK_NATIVE_EVM_RECIPIENT,
      amountWei: DUSK_NATIVE_AMOUNT_WEI,
      extraData: DUSK_NATIVE_RECIPIENT,
    });
    const message = {
      withdrawal: sampleWithdrawal(),
      withdrawalHash: hashWithdrawal(sampleWithdrawal()),
      blockNumber: 123n,
      transactionHash: "0xl2",
    };

    expect(withdrawalLifecycleStatus({ operation, now: () => 1 })).toMatchObject({
      phase: "prepared",
      metadata: { stage: "l2_not_submitted", operationId: operation.id },
    });
    expect(
      withdrawalLifecycleStatus({
        operation,
        message,
        proof: sampleProof(),
        now: () => 2,
      })
    ).toMatchObject({
      phase: "accepted",
      metadata: {
        stage: "prove_ready",
        withdrawalHash: message.withdrawalHash,
        l2BlockNumber: "123",
      },
    });
    expect(
      withdrawalLifecycleStatus({
        operation,
        message,
        finalizeReceipt: { transactionHash: "tx-finalize", success: true, finalized: true },
        now: () => 3,
      })
    ).toMatchObject({
      phase: "finalized",
      metadata: { stage: "finalized", finalizeTransactionHash: "tx-finalize" },
    });
    expect(
      withdrawalLifecycleStatus({
        operation,
        message,
        finalizeReceipt: { transactionHash: "tx-finalize", success: true },
        now: () => 3,
      })
    ).toMatchObject({
      phase: "accepted",
      message: "Finalize transaction succeeded but is not finalized yet",
      metadata: { stage: "finalize_submitted", finalizeTransactionHash: "tx-finalize" },
    });
    expect(
      withdrawalLifecycleStatus({
        operation,
        message,
        finalizeReceipt: { transactionHash: "tx-finalize" },
        now: () => 3,
      })
    ).toMatchObject({
      phase: "submitted",
      metadata: { stage: "finalize_submitted", finalizeTransactionHash: "tx-finalize" },
    });
    expect(
      withdrawalLifecycleStatus({
        operation,
        message,
        finalizeReceipt: { transactionHash: "tx-finalize", success: false, finalized: true },
        now: () => 4,
      })
    ).toMatchObject({
      phase: "failed",
      metadata: { stage: "failed", finalizeTransactionHash: "tx-finalize" },
    });
    expect(
      withdrawalLifecycleStatus({
        operation,
        message,
        finalizeReceipt: { transactionHash: "tx-finalize", finalized: true },
        now: () => 5,
      })
    ).toMatchObject({
      phase: "submitted",
      message: "Finalize receipt is finalized but successful execution is not confirmed",
      metadata: { stage: "finalize_submitted", finalizeTransactionHash: "tx-finalize" },
    });
    expect(
      withdrawalLifecycleStatus({
        operation,
        message,
        proveReceipt: { transactionHash: "tx-prove", success: true, finalized: true },
        now: () => 6,
      })
    ).toMatchObject({
      phase: "accepted",
      metadata: { stage: "proven", proveTransactionHash: "tx-prove" },
    });
    expect(
      withdrawalLifecycleStatus({
        operation,
        message,
        proveReceipt: { transactionHash: "tx-prove", success: true },
        now: () => 6,
      })
    ).toMatchObject({
      phase: "accepted",
      message: "Prove transaction succeeded but is not finalized yet",
      metadata: { stage: "prove_submitted", proveTransactionHash: "tx-prove" },
    });
    expect(
      withdrawalLifecycleStatus({
        operation,
        message,
        proveReceipt: { transactionHash: "tx-prove", finalized: true },
        now: () => 6,
      })
    ).toMatchObject({
      phase: "submitted",
      message: "Prove receipt is finalized but successful execution is not confirmed",
      metadata: { stage: "prove_submitted", proveTransactionHash: "tx-prove" },
    });
    expect(
      withdrawalLifecycleStatus({
        operation,
        message,
        proveReceipt: { transactionHash: "tx-prove" },
        now: () => 6,
      })
    ).toMatchObject({
      phase: "submitted",
      metadata: { stage: "prove_submitted", proveTransactionHash: "tx-prove" },
    });
    expect(withdrawalLifecycleStatus({ operation, failure: "boom", now: () => 7 })).toMatchObject({
      phase: "failed",
      message: "boom",
      metadata: { stage: "failed", reason: "boom" },
    });
  });
});

function sampleWithdrawal(): WithdrawalTransaction {
  return {
    nonce: 1n,
    sender: SENDER,
    target: TARGET,
    value: 5n,
    gasLimit: 200_000n,
    data: "0x1234",
  };
}

function sampleProof(): WithdrawalProofData {
  return {
    disputeGameIndex: 7n,
    outputRootProof: {
      version: `0x${"00".repeat(32)}`,
      stateRoot: `0x${"11".repeat(32)}`,
      messagePasserStorageRoot: `0x${"22".repeat(32)}`,
      latestBlockhash: `0x${"33".repeat(32)}`,
    } satisfies OutputRootProof,
    withdrawalProof: ["0xabcd"],
  };
}

function messagePassedLog(withdrawal: WithdrawalTransaction, hash = hashWithdrawal(withdrawal)) {
  const topics = encodeEventTopics({
    abi: l2ToL1MessagePasserAbi,
    eventName: "MessagePassed",
    args: {
      nonce: withdrawal.nonce,
      sender: withdrawal.sender,
      target: withdrawal.target,
    },
  }) as readonly `0x${string}`[];

  return {
    address: "0x4200000000000000000000000000000000000016",
    topics,
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes32" }],
      [withdrawal.value, withdrawal.gasLimit, withdrawal.data, hash]
    ),
    logIndex: 3,
  };
}
