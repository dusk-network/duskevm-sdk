import { createBridgeClient } from "./client.js";

const DRC20_ID = `0x${"ab".repeat(32)}` as const;
const DRC721_ID = `0x${"cd".repeat(32)}` as const;
const L1_TOKEN = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const L2_TOKEN = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

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
            gasPriceLux: 1n,
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
      duskContractId: DRC20_ID,
      l1Token: L1_TOKEN,
      l2Token: L2_TOKEN,
      amount: 5n,
      l2Recipient: "0x2222222222222222222222222222222222222222",
    });
    const drc721 = bridge.prepareDrc721Deposit({
      duskContractId: DRC721_ID,
      l1Token: L1_TOKEN,
      l2Token: L2_TOKEN,
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
      duskContractId: DRC721_ID,
      l1Token: "0x1111111111111111111111111111111111111111",
      l2Token: "0x2222222222222222222222222222222222222222",
      tokenId: "b",
      l2Recipient: "0x4444444444444444444444444444444444444444",
    });
    const right = bridge.prepareDrc721Deposit({
      duskContractId: DRC721_ID,
      l1Token: "0x1111111111111111111111111111111111111111",
      l2Token: "0x2222222222222222222222222222222222222222",
      tokenId: "a:b",
      l2Recipient: "0x4444444444444444444444444444444444444444",
    });

    expect(left.id).not.toBe(right.id);
  });

  it("canonicalizes uppercase DRC registry contract ids for operation identity and calldata", async () => {
    const bridge = createBridgeClient({
      contracts: {
        l1StandardBridgeContractId: "standard-bridge",
        l1Erc721BridgeContractId: "erc721-bridge",
      },
    });
    const prefixedDrc20 = bridge.prepareDrc20Deposit({
      duskContractId: DRC20_ID,
      l1Token: L1_TOKEN,
      l2Token: L2_TOKEN,
      amount: 5n,
      l2Recipient: "0x5555555555555555555555555555555555555555",
    });
    const uppercaseDrc20 = bridge.prepareDrc20Deposit({
      duskContractId: `0x${DRC20_ID.slice(2).toUpperCase()}`,
      l1Token: L1_TOKEN,
      l2Token: L2_TOKEN,
      amount: 5n,
      l2Recipient: "0x5555555555555555555555555555555555555555",
    });
    const prefixedDrc721 = bridge.prepareDrc721Deposit({
      duskContractId: DRC721_ID,
      l1Token: L1_TOKEN,
      l2Token: L2_TOKEN,
      tokenId: 1n,
      l2Recipient: "0x5555555555555555555555555555555555555555",
    });
    const uppercaseDrc721 = bridge.prepareDrc721Deposit({
      duskContractId: `0x${DRC721_ID.slice(2).toUpperCase()}`,
      l1Token: L1_TOKEN,
      l2Token: L2_TOKEN,
      tokenId: 1n,
      l2Recipient: "0x5555555555555555555555555555555555555555",
    });

    expect(prefixedDrc20.id).toBe(uppercaseDrc20.id);
    expect(prefixedDrc721.id).toBe(uppercaseDrc721.id);
    expect(await bridge.buildL1Transaction(prefixedDrc20)).toEqual(
      await bridge.buildL1Transaction(uppercaseDrc20)
    );
    expect(await bridge.buildL1Transaction(prefixedDrc721)).toEqual(
      await bridge.buildL1Transaction(uppercaseDrc721)
    );
  });

  it("rejects unprefixed DRC registry contract ids", () => {
    const bridge = createBridgeClient();

    expect(() =>
      bridge.prepareDrc20Deposit({
        duskContractId: DRC20_ID.slice(2) as never,
        l1Token: L1_TOKEN,
        l2Token: L2_TOKEN,
        amount: 5n,
        l2Recipient: "0x5555555555555555555555555555555555555555",
      })
    ).toThrow(/32-byte hex/);
  });

  it("canonicalizes EVM recipients and token addresses for operation identity and calldata", async () => {
    const bridge = createBridgeClient({
      contracts: {
        l1StandardBridgeContractId: "standard-bridge",
        l1Erc721BridgeContractId: "erc721-bridge",
      },
    });
    const l2Recipient = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const uppercaseRecipient = l2Recipient.toUpperCase() as typeof l2Recipient;
    const uppercaseL1Token = L1_TOKEN.toUpperCase() as typeof L1_TOKEN;
    const uppercaseL2Token = L2_TOKEN.toUpperCase() as typeof L2_TOKEN;
    const canonicalDrc20 = bridge.prepareDrc20Deposit({
      duskContractId: DRC20_ID,
      l1Token: L1_TOKEN,
      l2Token: L2_TOKEN,
      amount: 5n,
      l2Recipient,
    });
    const uppercaseDrc20 = bridge.prepareDrc20Deposit({
      duskContractId: DRC20_ID,
      l1Token: uppercaseL1Token,
      l2Token: uppercaseL2Token,
      amount: 5n,
      l2Recipient: uppercaseRecipient,
    });
    const canonicalDrc721 = bridge.prepareDrc721Deposit({
      duskContractId: DRC721_ID,
      l1Token: L1_TOKEN,
      l2Token: L2_TOKEN,
      tokenId: 1n,
      l2Recipient,
    });
    const uppercaseDrc721 = bridge.prepareDrc721Deposit({
      duskContractId: DRC721_ID,
      l1Token: uppercaseL1Token,
      l2Token: uppercaseL2Token,
      tokenId: 1n,
      l2Recipient: uppercaseRecipient,
    });

    expect(uppercaseDrc20.id).toBe(canonicalDrc20.id);
    expect(uppercaseDrc20.asset).toEqual(canonicalDrc20.asset);
    expect(uppercaseDrc20.envelopeHex).toBe(canonicalDrc20.envelopeHex);
    expect(uppercaseDrc20.metadata.l2Recipient).toBe(l2Recipient);
    expect(await bridge.buildL1Transaction(uppercaseDrc20)).toEqual(
      await bridge.buildL1Transaction(canonicalDrc20)
    );
    expect(uppercaseDrc721.id).toBe(canonicalDrc721.id);
    expect(uppercaseDrc721.asset).toEqual(canonicalDrc721.asset);
    expect(uppercaseDrc721.envelopeHex).toBe(canonicalDrc721.envelopeHex);
    expect(uppercaseDrc721.metadata.l2Recipient).toBe(l2Recipient);
    expect(await bridge.buildL1Transaction(uppercaseDrc721)).toEqual(
      await bridge.buildL1Transaction(canonicalDrc721)
    );
  });

  it("rejects malformed EVM addresses as SDK operation errors", () => {
    const bridge = createBridgeClient();
    const prepareInvalidToken = () =>
      bridge.prepareDrc20Deposit({
        duskContractId: DRC20_ID,
        l1Token: "not-an-address" as never,
        l2Token: L2_TOKEN,
        amount: 5n,
        l2Recipient: "0x5555555555555555555555555555555555555555",
      });

    expect(() =>
      bridge.prepareNativeDeposit({
        amountLux: 10n,
        l2Recipient: "0x1234" as never,
      })
    ).toThrow(/Bridge L2 recipient must be a 20-byte/);
    expect(prepareInvalidToken).toThrow(/Bridge L1 token must be a 20-byte/);
    try {
      prepareInvalidToken();
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_OPERATION" });
    }
  });

  it("builds default L1 transactions for configured bridge contracts", async () => {
    const bridge = createBridgeClient({
      contracts: {
        l1StandardBridgeContractId: "standard-bridge",
        l1Erc721BridgeContractId: "erc721-bridge",
      },
      gas: {
        defaultMinGasLimit: 250_000,
        l1GasLimit: 900_000n,
        gasPriceLux: 2n,
      },
    });

    await expect(
      bridge.buildL1Transaction(
        bridge.prepareNativeDeposit({
          amountLux: 10n,
          l2Recipient: "0x5555555555555555555555555555555555555555",
        })
      )
    ).resolves.toMatchObject({
      contractId: "standard-bridge",
      method: "depositETHToWithValue",
      amountLux: 10n,
      gasLimit: 900_000n,
      gasPriceLux: 2n,
      args: ["0x5555555555555555555555555555555555555555", "10", 250_000, expect.any(String)],
    });

    await expect(
      bridge.buildL1Transaction(
        bridge.prepareDrc20Deposit({
          duskContractId: DRC20_ID,
          l1Token: L1_TOKEN,
          l2Token: L2_TOKEN,
          amount: 5n,
          l2Recipient: "0x5555555555555555555555555555555555555555",
        })
      )
    ).resolves.toMatchObject({
      contractId: "standard-bridge",
      method: "bridgeERC20To",
      args: [
        L1_TOKEN,
        L2_TOKEN,
        "0x5555555555555555555555555555555555555555",
        "5",
        250_000,
        expect.stringMatching(/^0x10/),
      ],
    });

    await expect(
      bridge.buildL1Transaction(
        bridge.prepareDrc721Deposit({
          duskContractId: DRC721_ID,
          l1Token: L1_TOKEN,
          l2Token: L2_TOKEN,
          tokenId: 1n,
          l2Recipient: "0x5555555555555555555555555555555555555555",
        })
      )
    ).resolves.toMatchObject({
      contractId: "erc721-bridge",
      method: "bridgeERC721To",
      args: [
        L1_TOKEN,
        L2_TOKEN,
        "0x5555555555555555555555555555555555555555",
        "1",
        250_000,
        expect.stringMatching(/^0x11/),
      ],
    });
  });

  it("keeps per-operation gas overrides typed and separate from tracking metadata", async () => {
    const bridge = createBridgeClient({
      contracts: {
        l1StandardBridgeContractId: "standard-bridge",
      },
      gas: {
        defaultMinGasLimit: 250_000,
        l1GasLimit: 900_000n,
        gasPriceLux: 2n,
      },
    });
    const operation = bridge.prepareNativeDeposit({
      amountLux: 10n,
      l2Recipient: "0x5555555555555555555555555555555555555555",
      minGasLimit: 300_000,
      l1GasLimit: 1_000_000n,
      gasPriceLux: 3n,
    });

    expect(operation.gas).toEqual({
      minGasLimit: 300_000,
      l1GasLimit: 1_000_000n,
      gasPriceLux: 3n,
    });
    expect(operation.metadata).not.toHaveProperty("minGasLimit");
    expect(operation.metadata).not.toHaveProperty("l1GasLimit");
    expect(operation.metadata).not.toHaveProperty("gasPriceLux");
    await expect(bridge.buildL1Transaction(operation)).resolves.toMatchObject({
      gasLimit: 1_000_000n,
      gasPriceLux: 3n,
      args: ["0x5555555555555555555555555555555555555555", "10", 300_000, expect.any(String)],
    });
  });

  it("rejects bridge min gas limits that do not fit the contract uint32", async () => {
    const bridge = createBridgeClient({
      contracts: {
        l1StandardBridgeContractId: "standard-bridge",
      },
    });

    await expect(
      bridge.buildL1Transaction(
        bridge.prepareNativeDeposit({
          amountLux: 10n,
          l2Recipient: "0x5555555555555555555555555555555555555555",
          minGasLimit: 0x1_0000_0000,
        })
      )
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
  });

  it("fails clearly when a default bridge builder lacks required contract ids", async () => {
    const nativeBridge = createBridgeClient({ contracts: {} });
    await expect(
      nativeBridge.buildL1Transaction(
        nativeBridge.prepareNativeDeposit({
          amountLux: 10n,
          l2Recipient: "0x5555555555555555555555555555555555555555",
        })
      )
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });

    const erc721Bridge = createBridgeClient({
      contracts: {
        l1StandardBridgeContractId: "standard-bridge",
      },
    });
    await expect(
      erc721Bridge.buildL1Transaction(
        erc721Bridge.prepareDrc721Deposit({
          duskContractId: DRC721_ID,
          l1Token: L1_TOKEN,
          l2Token: L2_TOKEN,
          tokenId: 1n,
          l2Recipient: "0x5555555555555555555555555555555555555555",
        })
      )
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("submits typed deposits and returns resumable status metadata", async () => {
    const bridge = createBridgeClient({
      l1: {
        async submitTransaction(request) {
          expect(request.gasPriceLux).toBe(7n);
          return { transactionHash: "dusk-tx" };
        },
        async getGasPriceLux() {
          return 7n;
        },
      },
      contracts: {
        l1StandardBridgeContractId: "standard-bridge",
      },
    });

    await expect(
      bridge.submitNativeDeposit({
        amountLux: 10n,
        l2Recipient: "0x5555555555555555555555555555555555555555",
        metadata: {
          requestId: "request-1",
          operationId: "caller-cannot-override",
        },
      })
    ).resolves.toMatchObject({
      submittedTransaction: { transactionHash: "dusk-tx" },
      status: {
        phase: "submitted",
        metadata: {
          l1TransactionHash: "dusk-tx",
          direction: "l1-to-l2",
          assetKind: "native",
          operationId: expect.stringMatching(/^deposit:0x[0-9a-f]{64}$/),
          requestId: "request-1",
        },
      },
    });
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

  it("waits for bridge operation status through the configured observer", async () => {
    const statuses = [
      { phase: "submitted" as const, updatedAt: 1, metadata: { l1TransactionHash: "tx" } },
      { phase: "finalized" as const, updatedAt: 2, metadata: { l1TransactionHash: "tx" } },
    ];
    const bridge = createBridgeClient({
      observeOperationStatus: async () => statuses.shift()!,
    });
    const prepared = bridge.prepareNativeDeposit({
      amountLux: 10n,
      l2Recipient: "0x5555555555555555555555555555555555555555",
    });

    await expect(
      bridge.waitForOperationStatus(prepared, {
        intervalMs: 1,
        timeoutMs: 100,
      })
    ).resolves.toEqual({
      phase: "finalized",
      updatedAt: 2,
      metadata: { l1TransactionHash: "tx" },
    });
  });

  it("waits through an observer assigned after client construction", async () => {
    const bridge = createBridgeClient();
    bridge.observeOperationStatus = async () => ({
      phase: "finalized",
      updatedAt: 3,
      metadata: { l1TransactionHash: "tx" },
    });
    const prepared = bridge.prepareNativeDeposit({
      amountLux: 10n,
      l2Recipient: "0x5555555555555555555555555555555555555555",
    });

    await expect(
      bridge.waitForOperationStatus(prepared, {
        intervalMs: 1,
        timeoutMs: 100,
      })
    ).resolves.toEqual({
      phase: "finalized",
      updatedAt: 3,
      metadata: { l1TransactionHash: "tx" },
    });
  });

  it("rejects asynchronously when no bridge operation observer is configured", async () => {
    const bridge = createBridgeClient();
    const prepared = bridge.prepareNativeDeposit({
      amountLux: 10n,
      l2Recipient: "0x5555555555555555555555555555555555555555",
    });

    await expect(bridge.waitForOperationStatus(prepared)).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
  });
});
