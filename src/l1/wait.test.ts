import { sdkError } from "../errors.js";
import { submitDuskL1Transaction, waitForDuskL1Transaction } from "./wait.js";

describe("Dusk L1 submit and wait helpers", () => {
  it("resolves gas price from the node before submitting", async () => {
    await expect(
      submitDuskL1Transaction(
        {
          async submitTransaction(request) {
            expect(request.gasPriceLux).toBe(12n);
            return { transactionHash: "tx-hash" };
          },
          async getGasPriceLux() {
            return 12n;
          },
        },
        {
          kind: "contract_call",
          contractId: "bridge",
          method: "deposit",
        }
      )
    ).resolves.toMatchObject({
      submitted: { transactionHash: "tx-hash" },
      request: { gasPriceLux: 12n },
    });
  });

  it("waits for successful transaction receipts", async () => {
    await expect(
      waitForDuskL1Transaction(
        {
          async waitForTransaction(transactionHash) {
            return { transactionHash, success: true, finalized: true };
          },
        },
        "tx-hash"
      )
    ).resolves.toEqual({ transactionHash: "tx-hash", success: true, finalized: true });
  });

  it("surfaces failed and timed-out transactions as typed errors", async () => {
    await expect(
      waitForDuskL1Transaction(
        {
          async waitForTransaction(transactionHash) {
            return { transactionHash, success: false };
          },
        },
        "tx-hash"
      )
    ).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });

    await expect(
      waitForDuskL1Transaction(
        {
          async waitForTransaction(transactionHash) {
            return { transactionHash };
          },
        },
        "tx-hash"
      )
    ).rejects.toMatchObject({ code: "CLIENT_ERROR" });

    await expect(
      waitForDuskL1Transaction(
        {
          async waitForTransaction() {
            throw sdkError("TIMEOUT", "timed out");
          },
        },
        "tx-hash"
      )
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});
