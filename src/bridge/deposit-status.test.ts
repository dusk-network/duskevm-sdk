import type { Hex } from "../types.js";
import {
  observeDepositStatus,
  waitForDepositStatus,
  type DepositReceiptClient,
  type DepositTransactionReceipt,
} from "./deposit-status.js";

const L1_HASH =
  "0xedd48f60f23d7cb7fdb84851628b10f0ecc4a7d03d8d99e5247894b2bcd77643";
const L2_HASH =
  "0x719503f03d4d9ac964396ec4fcd641c89eeec57eccd2b090740cdee8a62cfb69";
const RELAYED_MESSAGE_TOPIC =
  "0x4641df4a962071e12719d8c8c8e5ac7fc4d97b927346a3d7a335b1f7517e133c";
const FAILED_RELAYED_MESSAGE_TOPIC =
  "0x99d0e048484baa1b1540b1367cb128acd7ab2946d1ed91ec10e3c85e4bf51b8f";

const L1_DEPOSIT_LOG = {
  address: "0x04f9a1f9da4866beefcbf13d877134c42616a528",
  blockHash:
    "0x5900e26547ab7a5c0460994827fae547d3bed9f34083fb13b1bea494e7b13bd8",
  blockNumber: 1346n,
  data: "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000001ed00000000000000000000000000000000000000000000001b1ae4d6e2ef50000000000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000007190c00d764ad0b000100000000000000000000000000000000000000000000000000000000000000000000000000000000000090f5579974a05ec635839caadde462249b959642000000000000000000000000420000000000000000000000000000000000001000000000000000000000000000000000000000000000001b1ae4d6e2ef50000000000000000000000000000000000000000000000000000000000000000249f000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000a41635f5fd000000000000000000000000eafa787b94bbc9ca8ad2f49acfa9933265165a56000000000000000000000000eb9ea22334e679cdbc669cf9ad2d713b559708b100000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  logIndex: 2,
  removed: false,
  topics: [
    "0xb3813568d9991fc951961fcb4c784893574240a28925604d09fc577c55bb7c32",
    "0x000000000000000000000000f0e4110bc051e2d3d1fbd3b114d839e46cd7a794",
    "0x0000000000000000000000004200000000000000000000000000000000000007",
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  ],
  transactionHash: L1_HASH,
  transactionIndex: 0,
} as const;

describe("deposit lifecycle status", () => {
  it("keeps a missing L1 receipt pending", async () => {
    const l1Client = missingReceiptClient();

    await expect(
      observeDepositStatus({
        l1Client,
        l2Client: missingReceiptClient(),
        l1TransactionHash: L1_HASH.slice(2),
        now: () => 1,
      }),
    ).resolves.toEqual({
      phase: "submitted",
      updatedAt: 1,
      metadata: {
        l1TransactionHash: L1_HASH,
        stage: "l1_pending",
      },
    });
  });

  it("reports a conclusive Dusk L1 revert", async () => {
    await expect(
      observeDepositStatus({
        l1Client: receiptClient(l1Receipt("reverted")),
        l2Client: missingReceiptClient(),
        l1TransactionHash: L1_HASH,
        now: () => 2,
      }),
    ).resolves.toMatchObject({
      phase: "failed",
      message: "The Dusk L1 bridge transaction failed",
      metadata: {
        failureLayer: "l1",
        l1BlockHeight: "1346",
        stage: "failed",
      },
    });
  });

  it("derives the OP transaction hash and waits for its L2 receipt", async () => {
    await expect(
      observeDepositStatus({
        l1Client: receiptClient(l1Receipt()),
        l2Client: missingReceiptClient(),
        l1TransactionHash: L1_HASH,
        metadata: { requestId: "request-1" },
        now: () => 3,
      }),
    ).resolves.toEqual({
      phase: "accepted",
      updatedAt: 3,
      metadata: {
        requestId: "request-1",
        l1TransactionHash: L1_HASH,
        l1BlockHeight: "1346",
        l2TransactionHash: L2_HASH,
        l2TransactionHashes: [L2_HASH],
        stage: "l2_pending",
      },
    });
  });

  it("completes only after the cross-domain relay succeeds", async () => {
    await expect(
      observeDepositStatus({
        l1Client: receiptClient(l1Receipt()),
        l2Client: receiptClient(l2Receipt(RELAYED_MESSAGE_TOPIC)),
        l1TransactionHash: L1_HASH,
        now: () => 4,
      }),
    ).resolves.toMatchObject({
      phase: "finalized",
      metadata: {
        l2BlockNumber: "6251",
        l2TransactionHash: L2_HASH,
        stage: "completed",
      },
    });
  });

  it("reports a successful L2 transaction that emitted FailedRelayedMessage", async () => {
    await expect(
      observeDepositStatus({
        l1Client: receiptClient(l1Receipt()),
        l2Client: receiptClient(l2Receipt(FAILED_RELAYED_MESSAGE_TOPIC)),
        l1TransactionHash: L1_HASH,
      }),
    ).resolves.toMatchObject({
      phase: "failed",
      message: "The DuskEVM cross-domain relay failed",
      metadata: {
        failureLayer: "l2",
        stage: "failed",
      },
    });
  });

  it("does not misclassify RPC failures or unrecognized receipts as bridge failure", async () => {
    const networkError = new Error("RPC unavailable");

    await expect(
      observeDepositStatus({
        l1Client: {
          async getTransactionReceipt() {
            throw networkError;
          },
        },
        l2Client: missingReceiptClient(),
        l1TransactionHash: L1_HASH,
      }),
    ).rejects.toBe(networkError);

    await expect(
      observeDepositStatus({
        l1Client: receiptClient(l1Receipt()),
        l2Client: receiptClient(l2Receipt()),
        l1TransactionHash: L1_HASH,
      }),
    ).rejects.toMatchObject({ code: "CLIENT_ERROR" });
  });

  it("preserves the last known layer when waiting times out", async () => {
    await expect(
      waitForDepositStatus({
        l1Client: receiptClient(l1Receipt()),
        l2Client: missingReceiptClient(),
        l1TransactionHash: L1_HASH,
        intervalMs: 1,
        timeoutMs: 0,
        now: () => 5,
      }),
    ).resolves.toMatchObject({
      phase: "timed_out",
      metadata: {
        l2TransactionHash: L2_HASH,
        stage: "l2_pending",
      },
    });
  });
});

function receiptClient(
  receipt: DepositTransactionReceipt,
): DepositReceiptClient {
  return {
    async getTransactionReceipt() {
      return receipt;
    },
  };
}

function missingReceiptClient(): DepositReceiptClient {
  return {
    async getTransactionReceipt() {
      const error = new Error("receipt not found");
      error.name = "TransactionReceiptNotFoundError";
      throw error;
    },
  };
}

function l1Receipt(
  status: "success" | "reverted" = "success",
): DepositTransactionReceipt {
  return {
    blockNumber: 1346n,
    logs: [L1_DEPOSIT_LOG],
    status,
    transactionHash: L1_HASH,
  };
}

function l2Receipt(
  topic?: Hex,
  status: "success" | "reverted" = "success",
): DepositTransactionReceipt {
  return {
    blockNumber: 6251n,
    logs:
      topic === undefined
        ? []
        : [
            {
              address: "0x4200000000000000000000000000000000000007",
              blockHash:
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              blockNumber: 6251n,
              data: "0x",
              logIndex: 2,
              removed: false,
              topics: [topic],
              transactionHash: L2_HASH,
              transactionIndex: 0,
            },
          ],
    status,
    transactionHash: L2_HASH,
  };
}
