import { createBridgeClient } from "./client.js";

describe("bridge client", () => {
  it("prepares native deposit operations with an EVM-targeted envelope", () => {
    const bridge = createBridgeClient();
    const prepared = bridge.prepareNativeDeposit({
      amountLux: 10n,
      l2Recipient: "0x1111111111111111111111111111111111111111",
    });

    expect(prepared.direction).toBe("l1-to-l2");
    expect(prepared.asset).toEqual({ kind: "native", amountLux: 10n });
    expect(prepared.envelope.target).toEqual({
      kind: "evm",
      value: "0x1111111111111111111111111111111111111111",
    });
  });

  it("submits through an injected L1 transaction builder", async () => {
    const bridge = createBridgeClient({
      l1: {
        async submitTransaction(request) {
          expect(request).toEqual({
            kind: "contract_call",
            contractId: "bridge",
            method: "deposit",
            args: { id: operationId },
          });
          return { transactionHash: "tx-hash" };
        },
      },
      buildL1Transaction(operation) {
        operationId = operation.id;
        return {
          kind: "contract_call",
          contractId: "bridge",
          method: "deposit",
          args: { id: operation.id },
        };
      },
    });
    let operationId = "";

    const prepared = bridge.prepareNativeDeposit({
      amountLux: 10n,
      l2Recipient: "0x1111111111111111111111111111111111111111",
    });

    await expect(bridge.submitPreparedOperation(prepared)).resolves.toEqual({
      transactionHash: "tx-hash",
    });
    expect(operationId).toMatch(/^deposit:0x[0-9a-f]{64}$/);
  });

  it("prepares DRC20 and DRC721 deposits without duplicating envelope logic", () => {
    const bridge = createBridgeClient();
    const drc20 = bridge.prepareDrc20Deposit({
      contractId: "drc20-id",
      amount: 5n,
      l2Recipient: "0x2222222222222222222222222222222222222222",
    });
    const drc721 = bridge.prepareDrc721Deposit({
      contractId: "drc721-id",
      tokenId: "token-1",
      l2Recipient: "0x3333333333333333333333333333333333333333",
    });

    expect(drc20.asset.kind).toBe("drc20");
    expect(drc721.asset.kind).toBe("drc721");
    expect(drc20.envelope.target.kind).toBe("evm");
    expect(drc721.envelope.target.kind).toBe("evm");
  });

  it("does not collide when DRC721 string fields contain delimiters", () => {
    const bridge = createBridgeClient();
    const left = bridge.prepareDrc721Deposit({
      contractId: "contract:a",
      tokenId: "b",
      l2Recipient: "0x4444444444444444444444444444444444444444",
    });
    const right = bridge.prepareDrc721Deposit({
      contractId: "contract",
      tokenId: "a:b",
      l2Recipient: "0x4444444444444444444444444444444444444444",
    });

    expect(left.id).not.toBe(right.id);
  });

  it("does not collide when payloads differ for the same asset and recipient", () => {
    const bridge = createBridgeClient();
    const left = bridge.prepareNativeDeposit({
      amountLux: 10n,
      payload: "0x01",
      l2Recipient: "0x5555555555555555555555555555555555555555",
    });
    const right = bridge.prepareNativeDeposit({
      amountLux: 10n,
      payload: "0x02",
      l2Recipient: "0x5555555555555555555555555555555555555555",
    });

    expect(left.id).not.toBe(right.id);
  });
});
