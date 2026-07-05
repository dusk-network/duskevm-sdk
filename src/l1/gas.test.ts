import {
  DEFAULT_DUSK_DEPLOYMENT_GAS_PRICE_LUX,
  DEFAULT_DUSK_GAS_PRICE_LUX,
  minimumSpendableLux,
  resolveDuskGasPriceLux,
} from "./gas.js";

describe("Dusk gas helpers", () => {
  it("defaults normal calls to one Lux gas price", async () => {
    await expect(resolveDuskGasPriceLux()).resolves.toBe(DEFAULT_DUSK_GAS_PRICE_LUX);
  });

  it("keeps deployment gas pricing explicit", async () => {
    await expect(resolveDuskGasPriceLux({ deployment: true })).resolves.toBe(
      DEFAULT_DUSK_DEPLOYMENT_GAS_PRICE_LUX
    );
  });

  it("prefers client gas price before defaults", async () => {
    await expect(
      resolveDuskGasPriceLux({ client: { getGasPriceLux: async () => 42n } })
    ).resolves.toBe(42n);
  });

  it("computes minimum spendable balance", () => {
    expect(minimumSpendableLux({ gasLimit: 10n, gasPriceLux: 2n, bufferLux: 3n })).toBe(23n);
  });
});
