import { duskEvmMainnet, duskEvmTestnet } from "./chains.js";

describe("DuskEVM chains", () => {
  it("defines mainnet and testnet with DUSK native currency", () => {
    expect(duskEvmMainnet.id).toBe(744);
    expect(duskEvmTestnet.id).toBe(745);
    expect(duskEvmTestnet.nativeCurrency.symbol).toBe("DUSK");
  });
});
