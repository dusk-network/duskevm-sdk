import { createDuskConnectL1Client } from "./dusk-connect.js";

describe("Dusk Connect L1 client adapter", () => {
  it("submits wallet transactions and normalizes hashes", async () => {
    const calls: unknown[] = [];
    const client = createDuskConnectL1Client({
      async sendTransaction(request) {
        calls.push(request);
        return { transactionHash: "dusk-tx" };
      },
    });

    await expect(
      client.submitTransaction({
        kind: "contract_call",
        contractId: "bridge",
        method: "deposit",
        args: { amount: "1" },
        gasLimit: 10n,
      })
    ).resolves.toEqual({ transactionHash: "dusk-tx", raw: { transactionHash: "dusk-tx" } });

    expect(calls).toEqual([
      {
        kind: "contract_call",
        contract: "bridge",
        fn: "deposit",
        args: { amount: "1" },
        gasLimit: "10",
      },
    ]);
  });

  it("preserves optional wallet transaction fields when provided", async () => {
    const calls: unknown[] = [];
    const client = createDuskConnectL1Client({
      async sendTransaction(request) {
        calls.push(request);
        return { hash: "dusk-tx" };
      },
    });

    await client.submitTransaction({
      kind: "contract_call",
      contractId: "bridge",
      method: "deposit",
      args: { amount: "1" },
      gasLimit: 10n,
      gasPriceLux: 2n,
      metadata: { source: "test" },
    });

    expect(calls).toEqual([
      {
        kind: "contract_call",
        contract: "bridge",
        fn: "deposit",
        args: { amount: "1" },
        gasLimit: "10",
        gasPrice: "2",
        metadata: { source: "test" },
      },
    ]);
  });

  it("normalizes object gas price responses", async () => {
    const client = createDuskConnectL1Client({
      async sendTransaction() {
        return "hash";
      },
      async getGasPrice() {
        return { gasPrice: "123" };
      },
    });

    await expect(client.getGasPriceLux?.()).resolves.toBe(123n);
  });
});
