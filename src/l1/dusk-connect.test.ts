import { sdkError } from "../errors.js";
import { createDuskConnectL1Client } from "./dusk-connect.js";
import { waitForDuskL1Transaction } from "./wait.js";

describe("Dusk Connect L1 client adapter", () => {
  it("uses the current low-level wallet contract-call shape with encoded arguments", async () => {
    const calls: unknown[] = [];
    const encodeContractCall = vi.fn(async () => new Uint8Array([0xaa, 0xbb]));
    const client = createDuskConnectL1Client(
      {
        async sendTransaction(request) {
          calls.push(request);
          return { hash: "dusk-tx" };
        },
      },
      { privacy: "public", encodeContractCall }
    );

    await expect(
      client.submitTransaction({
        kind: "contract_call",
        contractId: "bridge",
        method: "deposit",
        args: { amount: "1" },
        amountLux: 5n,
        gasLimit: 10n,
        gasPriceLux: 2n,
        metadata: { source: "test" },
      })
    ).resolves.toMatchObject({ transactionHash: "dusk-tx" });

    expect(encodeContractCall).toHaveBeenCalledWith({
      contractId: "bridge",
      method: "deposit",
      args: { amount: "1" },
    });
    expect(calls).toEqual([
      {
        kind: "contract_call",
        privacy: "public",
        contractId: "bridge",
        fnName: "deposit",
        fnArgs: new Uint8Array([0xaa, 0xbb]),
        deposit: "5",
        gas: { limit: "10", price: "2" },
        display: { source: "test" },
      },
    ]);
  });

  it("uses the Dusk Connect average gas-price statistic", async () => {
    const client = createDuskConnectL1Client(
      {
        async sendTransaction() {
          return { hash: "dusk-tx" };
        },
        async getGasPrice() {
          return { average: "123", max: "999", median: "100", min: "1" };
        },
      },
      { privacy: "public", encodeContractCall: async () => "0x" }
    );

    await expect(client.getGasPriceLux?.()).resolves.toBe(123n);
  });

  it.each([
    [{ status: "executed", ok: null }, "CLIENT_ERROR"],
    [{ status: "failed", ok: false }, "TRANSACTION_FAILED"],
    [{ status: "timeout", ok: false }, "TIMEOUT"],
    [{ status: "executed", ok: true, success: false }, "CLIENT_ERROR"],
  ])("fails closed for non-success receipt %#", async (receipt, code) => {
    const client = createDuskConnectL1Client(
      {
        async sendTransaction() {
          return { hash: "dusk-tx" };
        },
      },
      {
        privacy: "public",
        encodeContractCall: async () => "0x",
        waitForTransaction: async () => ({ hash: "dusk-tx", ...receipt }),
      }
    );

    await expect(waitForDuskL1Transaction(client, "dusk-tx")).rejects.toMatchObject({ code });
  });

  it("allows the host receipt tracker to retry after a transient wait failure", async () => {
    const waitForTransaction = vi
      .fn()
      .mockRejectedValueOnce(sdkError("TIMEOUT", "timed out"))
      .mockResolvedValueOnce({ hash: "dusk-tx", status: "executed", ok: true });
    const client = createDuskConnectL1Client(
      {
        async sendTransaction() {
          return { hash: "dusk-tx" };
        },
      },
      {
        privacy: "public",
        encodeContractCall: async () => "0x",
        waitForTransaction,
      }
    );

    await expect(waitForDuskL1Transaction(client, "dusk-tx")).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    await expect(waitForDuskL1Transaction(client, "dusk-tx")).resolves.toMatchObject({
      success: true,
    });
    expect(waitForTransaction).toHaveBeenCalledTimes(2);
  });
});
