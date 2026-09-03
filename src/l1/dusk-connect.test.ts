import { createDuskConnectL1Client } from "./dusk-connect.js";

const CONTRACT = { contractId: "bridge", driverUrl: "/bridge.wasm" };

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
        gas: { limit: "10", price: "2" },
        display: { source: "test" },
      },
    ]);
  });

  it("uses DuskApp data drivers for encoding, decoded reads, and handle-based waiting", async () => {
    const writes: unknown[] = [];
    const reads: unknown[] = [];
    const wait = vi.fn(async () => ({ hash: "dusk-tx", status: "executed", ok: true }));
    const app = {
      wallet: {
        async sendTransaction() {
          throw new Error("DuskApp must own contract submission");
        },
        async getGasPrice() {
          return { average: "123", max: "200", median: "100", min: "10" };
        },
      },
      async writeContract(request: unknown) {
        writes.push(request);
        return { hash: "dusk-tx", nonce: "7", wait };
      },
      async readContract(request: unknown) {
        reads.push(request);
        return ["decoded-state"];
      },
    };
    const client = createDuskConnectL1Client(app, {
      privacy: "shielded",
      resolveContract: (contractId) => ({ ...CONTRACT, contractId }),
    });

    await expect(client.getGasPriceLux?.()).resolves.toBe(123n);
    const submitted = await client.submitTransaction({
      kind: "contract_call",
      contractId: "bridge",
      method: "deposit",
      args: { amount: "1" },
      gasLimit: 10n,
      gasPriceLux: 3n,
      metadata: { source: "sdk" },
    });
    await expect(client.waitForTransaction?.(submitted.transactionHash)).resolves.toMatchObject({
      transactionHash: "dusk-tx",
      success: true,
    });
    await expect(
      client.readContract?.({ contractId: "portal", method: "paused" })
    ).resolves.toEqual(["decoded-state"]);

    expect(writes).toEqual([
      {
        contract: { ...CONTRACT, contractId: "bridge" },
        functionName: "deposit",
        args: { amount: "1" },
        privacy: "shielded",
        gas: { limit: "10", price: "3" },
        display: { source: "sdk" },
      },
    ]);
    expect(reads).toEqual([
      {
        contract: { ...CONTRACT, contractId: "portal" },
        functionName: "paused",
      },
    ]);
    expect(wait).toHaveBeenCalledOnce();
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

  it("rejects low-level wallet integration without a contract encoder", () => {
    expect(() =>
      createDuskConnectL1Client(
        {
          async sendTransaction() {
            return { hash: "dusk-tx" };
          },
        },
        { privacy: "public" }
      )
    ).toThrow(/encoded contract-call adapter/);
  });

  it("rejects DuskApp integration without a contract resolver", () => {
    expect(() =>
      createDuskConnectL1Client(
        {
          wallet: {
            async sendTransaction() {
              return { hash: "dusk-tx" };
            },
          },
          async writeContract() {
            return { hash: "dusk-tx" };
          },
        },
        { privacy: "public" }
      )
    ).toThrow(/contract resolver/);
  });
});
