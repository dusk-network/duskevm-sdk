import { formatLuxToDusk, parseDuskToLux, toLux } from "./amount.js";

describe("amount helpers", () => {
  it("parses DUSK into Lux", () => {
    expect(parseDuskToLux("1")).toBe(1_000_000_000n);
    expect(parseDuskToLux("1.5")).toBe(1_500_000_000n);
    expect(parseDuskToLux("0.000000001")).toBe(1n);
  });

  it("formats Lux into DUSK", () => {
    expect(formatLuxToDusk(1_000_000_000n)).toBe("1");
    expect(formatLuxToDusk(1_500_000_000n)).toBe("1.5");
    expect(formatLuxToDusk(1n)).toBe("0.000000001");
  });

  it("rejects unsafe numeric Lux", () => {
    expect(() => toLux(1.5)).toThrow(/invalid lux/i);
    expect(() => formatLuxToDusk(1.5)).toThrow(/invalid lux/i);
    expect(() => formatLuxToDusk(Number.MAX_SAFE_INTEGER + 1)).toThrow(/invalid lux/i);
  });

  it("rejects negative bigint Lux", () => {
    expect(() => toLux(-1n)).toThrow(/cannot be negative/i);
    expect(() => formatLuxToDusk(-1n)).toThrow(/cannot be negative/i);
  });
});
