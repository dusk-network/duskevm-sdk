import { createDuskEvmSdk } from "./sdk.js";

describe("DuskEVM SDK composition", () => {
  it("wires bridge, L1, and L2 clients without forcing either runtime", () => {
    const l1 = {
      submitTransaction: async () => ({ transactionHash: "tx" }),
    };
    const l2 = { name: "mock-l2-client" };

    const sdk = createDuskEvmSdk({ l1, l2 });

    expect(sdk.l1).toBe(l1);
    expect(sdk.l2).toBe(l2);
    expect(sdk.bridge.prepareNativeDeposit).toBeTypeOf("function");
  });
});
