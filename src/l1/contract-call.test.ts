import { createDuskConnectL1Client } from "./dusk-connect.js";
import {
  DEFAULT_DUSK_EVM_CONTRACT_CALL_MIN_GAS_LIMIT,
  prepareDuskEvmContractCall,
  submitDuskEvmContractCall,
} from "./contract-call.js";

const MESSENGER_ID = "11".repeat(32);
const TARGET = "0x2222222222222222222222222222222222222222";

describe("Dusk-to-DuskEVM contract calls", () => {
  it("prepares the allowlisted zero-value Messenger request", () => {
    const prepared = prepareDuskEvmContractCall({
      messengerContractId: MESSENGER_ID,
      target: TARGET,
      payload: new Uint8Array([0xab, 0xcd]),
    });

    expect(prepared).toMatchObject({
      messengerContractId: MESSENGER_ID,
      target: TARGET,
      payload: "0xabcd",
      minGasLimit: DEFAULT_DUSK_EVM_CONTRACT_CALL_MIN_GAS_LIMIT,
    });
    expect(prepared.l1Transaction).toEqual({
      kind: "contract_call",
      contractId: MESSENGER_ID,
      method: "sendMessage",
      args: [TARGET, "0xabcd", DEFAULT_DUSK_EVM_CONTRACT_CALL_MIN_GAS_LIMIT],
      metadata: {
        xdmDirection: "dusk-to-duskevm",
        target: TARGET,
        minGasLimit: DEFAULT_DUSK_EVM_CONTRACT_CALL_MIN_GAS_LIMIT,
      },
    });
    expect(prepared.l1Transaction).not.toHaveProperty("amountLux");
  });

  it("normalizes inputs and preserves explicit Dusk gas overrides", () => {
    const prepared = prepareDuskEvmContractCall({
      messengerContractId: MESSENGER_ID,
      target: TARGET.toUpperCase().replace("0X", "0x") as `0x${string}`,
      payload: "0xAABB",
      minGasLimit: 123,
      gasLimit: 4_000_000n,
      gasPriceLux: 2n,
    });

    expect(prepared.target).toBe(TARGET);
    expect(prepared.payload).toBe("0xaabb");
    expect(prepared.l1Transaction).toMatchObject({
      gasLimit: 4_000_000n,
      gasPriceLux: 2n,
      args: [TARGET, "0xaabb", 123],
    });
  });

  it("submits through Dusk Connect and optionally waits", async () => {
    const walletRequests: unknown[] = [];
    const client = createDuskConnectL1Client({
      async sendTransaction(request) {
        walletRequests.push(request);
        return { transactionHash: "dusk-message-tx" };
      },
      async getGasPrice() {
        return 3;
      },
      async waitForTxExecuted(transactionHash) {
        return { transactionHash, finalized: true, success: true };
      },
    });

    const submitted = await submitDuskEvmContractCall(
      client,
      {
        messengerContractId: MESSENGER_ID,
        target: TARGET,
        payload: "0x1234",
        minGasLimit: 250_000,
      },
      { wait: true }
    );

    expect(submitted.submission.submitted.transactionHash).toBe("dusk-message-tx");
    expect(submitted.submission.receipt?.success).toBe(true);
    expect(walletRequests).toEqual([
      {
        kind: "contract_call",
        contract: MESSENGER_ID,
        fn: "sendMessage",
        args: [TARGET, "0x1234", 250_000],
        gasPrice: "3",
        metadata: {
          xdmDirection: "dusk-to-duskevm",
          target: TARGET,
          minGasLimit: 250_000,
        },
      },
    ]);
  });

  it.each([
    [{ messengerContractId: "", target: TARGET }, /contract id is required/],
    [{ messengerContractId: MESSENGER_ID, target: "0x1234" }, /20-byte/],
    [
      { messengerContractId: MESSENGER_ID, target: TARGET, payload: "0x123" },
      /0x-prefixed byte hex/,
    ],
    [
      { messengerContractId: MESSENGER_ID, target: TARGET, minGasLimit: -1 },
      /must be a uint32/,
    ],
  ])("rejects invalid preparation input", (options, expected) => {
    expect(() => prepareDuskEvmContractCall(options as never)).toThrow(expected as RegExp);
  });
});
