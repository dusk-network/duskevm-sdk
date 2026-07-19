import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  type Hex,
} from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  L2_CROSS_DOMAIN_MESSENGER_ADDRESS,
  L2_STANDARD_BRIDGE_ADDRESS,
} from "../l2/index.js";
import type { WithdrawalTransaction } from "./withdrawal.js";
import {
  decodeDuskNativeContractCredit,
  duskContractIdToEvmAddress,
  encodeDuskNativeContractCredit,
} from "./asset-recipient.js";
import { createBridgeClient } from "./client.js";
import {
  buildClaimNativeCreditTransaction,
  buildNativeCreditReadRequest,
  nativeCreditLifecycleStatus,
  observeNativeCredit,
  parseNativeCreditWithdrawal,
  readNativeCredit,
  submitClaimNativeCredit,
  type NativeCredit,
} from "./native-credit.js";

const relayAbi = parseAbi([
  "function relayMessage(uint256 nonce,address sender,address target,uint256 value,uint256 minGasLimit,bytes message)",
]);
const bridgeAbi = parseAbi([
  "function finalizeBridgeETH(address from,address to,uint256 amount,bytes extraData)",
]);

const TARGET_ID = `0x${"11".repeat(32)}` as Hex;
const CREDIT_ID = `0x${"22".repeat(32)}` as Hex;
const PAYLOAD = "0x223344" as Hex;
const PAYLOAD_HASH = keccak256(PAYLOAD);
const L1_MESSENGER = "0x3333333333333333333333333333333333333333" as const;
const L1_BRIDGE = "0x4444444444444444444444444444444444444444" as const;
const L2_SENDER = "0x5555555555555555555555555555555555555555" as const;

describe("native contract credits", () => {
  it("encodes, decodes, and derives the canonical recipient", () => {
    const encoded = encodeDuskNativeContractCredit(TARGET_ID, PAYLOAD);
    expect(decodeDuskNativeContractCredit(encoded)).toEqual({
      targetContractId: TARGET_ID,
      payload: PAYLOAD,
    });
    expect(duskContractIdToEvmAddress(TARGET_ID)).toBe(`0x${keccak256(TARGET_ID).slice(-40)}`);
  });

  it("derives the on-chain credit id from the authenticated nested OP message", () => {
    const fixture = nativeCreditWithdrawal();
    const parsed = parseNativeCreditWithdrawal(fixture.withdrawal, {
      l1CrossDomainMessenger: L1_MESSENGER,
      l1StandardBridge: L1_BRIDGE,
    });

    expect(parsed).toEqual({
      creditId: fixture.creditId,
      targetContractId: TARGET_ID,
      targetEvmAddress: duskContractIdToEvmAddress(TARGET_ID),
      payload: PAYLOAD,
      payloadHash: PAYLOAD_HASH,
      l2Sender: L2_SENDER,
      l1StandardBridge: L1_BRIDGE,
      amountWei: 1_000_000_000n,
      amountLux: 1n,
    });
  });

  it("rejects recipient ambiguity and unauthenticated bridge routes", () => {
    expect(() => parseNativeCreditWithdrawal(nativeCreditWithdrawal({ wrongRecipient: true }).withdrawal))
      .toThrow(/recipient does not match/i);
    expect(() => parseNativeCreditWithdrawal(nativeCreditWithdrawal({ wrongOuterSender: true }).withdrawal))
      .toThrow(/L2 Messenger/i);
    expect(() => parseNativeCreditWithdrawal(nativeCreditWithdrawal({ wrongRelaySender: true }).withdrawal))
      .toThrow(/L2 Standard Bridge/i);
    expect(() => parseNativeCreditWithdrawal(nativeCreditWithdrawal({ wrongOuterValue: true }).withdrawal))
      .toThrow(/values do not match/i);
    expect(() => parseNativeCreditWithdrawal(nativeCreditWithdrawal({ wrongFinalizeAmount: true }).withdrawal))
      .toThrow(/bridge and relay amounts do not match/i);
    expect(() => parseNativeCreditWithdrawal(nativeCreditWithdrawal({ amount: 1n }).withdrawal))
      .toThrow(/exact Lux/i);
    expect(() => parseNativeCreditWithdrawal(nativeCreditWithdrawal().withdrawal, {
      l1CrossDomainMessenger: "0x8888888888888888888888888888888888888888",
    })).toThrow(/wrong L1 Messenger/i);
    expect(() => parseNativeCreditWithdrawal(nativeCreditWithdrawal().withdrawal, {
      l1StandardBridge: "0x9999999999999999999999999999999999999999",
    })).toThrow(/wrong L1 Standard Bridge/i);
  });

  it("builds authoritative reads and normalizes tuple and object responses", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValueOnce([TARGET_ID, L2_SENDER, "100000000", PAYLOAD_HASH, 1])
      .mockResolvedValueOnce({
        target_contract_id: TARGET_ID,
        l2_sender: L2_SENDER,
        amount_lux: 100000000,
        payload_hash: PAYLOAD_HASH,
        status: "3",
      });
    const reader = { readContract };

    const pending = await readNativeCredit(reader, {
      bridgeContractId: "bridge",
      creditId: CREDIT_ID,
    });
    expect(pending).toMatchObject({
      creditId: CREDIT_ID,
      amountLux: 100000000n,
      state: "pending",
      stateCode: 1,
    });
    expect(readContract).toHaveBeenNthCalledWith(1, buildNativeCreditReadRequest({
      bridgeContractId: "bridge",
      creditId: CREDIT_ID,
    }));

    const claimed = await readNativeCredit(reader, {
      bridgeContractId: "bridge",
      creditId: CREDIT_ID,
    });
    expect(claimed.state).toBe("claimed");
    expect(nativeCreditLifecycleStatus(claimed, () => 7)).toMatchObject({
      phase: "finalized",
      updatedAt: 7,
      metadata: { stage: "claimed", amountLux: "100000000" },
    });
  });

  it("builds, submits, and observes claims through direct and bridge-client APIs", async () => {
    const readContract = vi.fn(async () => [TARGET_ID, L2_SENDER, "100000000", PAYLOAD_HASH, 1]);
    const submitTransaction = vi.fn(async () => ({ transactionHash: "dusk-tx" }));
    const l1 = {
      readContract,
      submitTransaction,
      getGasPriceLux: vi.fn(async () => 4n),
    };
    const params = {
      bridgeContractId: "bridge",
      creditId: CREDIT_ID,
      payload: PAYLOAD,
      gasLimit: 5000000n,
    };

    expect(buildClaimNativeCreditTransaction(params)).toMatchObject({
      kind: "contract_call",
      contractId: "bridge",
      method: "claimNativeCredit",
      args: [CREDIT_ID, PAYLOAD],
      gasLimit: 5000000n,
    });
    const submitted = await submitClaimNativeCredit(l1, params);
    expect(submitted.submitted.transactionHash).toBe("dusk-tx");
    expect(submitTransaction).toHaveBeenLastCalledWith(expect.objectContaining({ gasPriceLux: 4n }));

    const bridge = createBridgeClient({
      l1,
      contracts: { l1StandardBridgeContractId: "bridge" },
    });
    expect((await bridge.readNativeCredit(CREDIT_ID)).state).toBe("pending");
    expect((await bridge.observeNativeCredit(CREDIT_ID)).metadata?.stage).toBe("credit_pending");
    expect(bridge.buildNativeCreditClaim({ creditId: CREDIT_ID, payload: PAYLOAD }).method)
      .toBe("claimNativeCredit");
    await expect(bridge.submitNativeCreditClaim({ creditId: CREDIT_ID, payload: PAYLOAD }))
      .resolves.toMatchObject({ submitted: { transactionHash: "dusk-tx" } });
  });

  it("maps every on-chain state to an explicit lifecycle stage", () => {
    const expected = [
      ["missing", "prepared", "credit_missing"],
      ["pending", "accepted", "credit_pending"],
      ["claiming", "submitted", "claim_in_progress"],
      ["claimed", "finalized", "claimed"],
    ] as const;
    for (const [state, phase, stage] of expected) {
      const credit: NativeCredit = {
        creditId: CREDIT_ID,
        targetContractId: TARGET_ID,
        l2Sender: L2_SENDER,
        amountLux: 1n,
        payloadHash: PAYLOAD_HASH,
        state,
        stateCode: ({ missing: 0, pending: 1, claiming: 2, claimed: 3 } as const)[state],
      };
      expect(nativeCreditLifecycleStatus(credit).phase).toBe(phase);
      expect(nativeCreditLifecycleStatus(credit).metadata?.stage).toBe(stage);
    }
  });

  it("rejects malformed query tuples and unknown states", async () => {
    await expect(readNativeCredit(
      { readContract: async () => [TARGET_ID, L2_SENDER, "1", PAYLOAD_HASH, 4] },
      { bridgeContractId: "bridge", creditId: CREDIT_ID }
    )).rejects.toThrow(/unknown state/i);
    await expect(observeNativeCredit(
      { readContract: async () => [TARGET_ID] },
      { bridgeContractId: "bridge", creditId: CREDIT_ID }
    )).rejects.toThrow(/invalid native credit tuple/i);
  });
});

function nativeCreditWithdrawal(options: {
  wrongRecipient?: boolean;
  wrongOuterSender?: boolean;
  wrongRelaySender?: boolean;
  wrongOuterValue?: boolean;
  wrongFinalizeAmount?: boolean;
  amount?: bigint;
} = {}): { withdrawal: WithdrawalTransaction; creditId: Hex } {
  const amount = options.amount ?? 1_000_000_000n;
  const recipient = options.wrongRecipient
    ? "0x6666666666666666666666666666666666666666"
    : duskContractIdToEvmAddress(TARGET_ID);
  const extraData = encodeDuskNativeContractCredit(TARGET_ID, PAYLOAD);
  const message = encodeFunctionData({
    abi: bridgeAbi,
    functionName: "finalizeBridgeETH",
    args: [L2_SENDER, recipient, options.wrongFinalizeAmount ? amount + 1n : amount, extraData],
  });
  const relayArgs = [
    17n,
    options.wrongRelaySender
      ? "0x7777777777777777777777777777777777777777"
      : L2_STANDARD_BRIDGE_ADDRESS,
    L1_BRIDGE,
    amount,
    250000n,
    message,
  ] as const;
  const data = encodeFunctionData({
    abi: relayAbi,
    functionName: "relayMessage",
    args: relayArgs,
  });
  const creditId = keccak256(encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes" },
    ],
    relayArgs
  ));
  return {
    creditId,
    withdrawal: {
      nonce: 9n,
      sender: options.wrongOuterSender
        ? "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        : L2_CROSS_DOMAIN_MESSENGER_ADDRESS,
      target: L1_MESSENGER,
      value: options.wrongOuterValue ? amount + 1n : amount,
      gasLimit: 500000n,
      data,
    },
  };
}
