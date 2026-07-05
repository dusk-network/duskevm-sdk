import { DRC20_REGISTRY_EXTRA_DATA_TAG, DRC721_REGISTRY_EXTRA_DATA_TAG, encodeDrcRegistryExtraData } from "./extradata.js";

const CONTRACT_ID = `0x${"ab".repeat(32)}` as const;

describe("Dusk bridge extraData helpers", () => {
  it("prefixes DRC20 and DRC721 registry identifiers before the payload", () => {
    expect(
      encodeDrcRegistryExtraData({
        kind: "drc20",
        duskContractId: CONTRACT_ID,
        payload: "0xabcd",
      })
    ).toBe(`0x${DRC20_REGISTRY_EXTRA_DATA_TAG.toString(16)}${"ab".repeat(32)}abcd`);

    expect(
      encodeDrcRegistryExtraData({
        kind: "drc721",
        duskContractId: CONTRACT_ID,
        payload: "0xabcd",
      })
    ).toBe(`0x${DRC721_REGISTRY_EXTRA_DATA_TAG.toString(16)}${"ab".repeat(32)}abcd`);
  });

  it("canonicalizes contract identifiers to lowercase hex", () => {
    expect(
      encodeDrcRegistryExtraData({
        kind: "drc20",
        duskContractId: CONTRACT_ID.toUpperCase() as never,
      })
    ).toBe(`0x${DRC20_REGISTRY_EXTRA_DATA_TAG.toString(16)}${"ab".repeat(32)}`);
  });

  it("rejects non-hex contract identifiers for registry payloads", () => {
    expect(() =>
      encodeDrcRegistryExtraData({
        kind: "drc20",
        duskContractId: "not-a-hex-id" as never,
      })
    ).toThrow(/32-byte hex/);
    expect(() =>
      encodeDrcRegistryExtraData({
        kind: "drc20",
        duskContractId: CONTRACT_ID.slice(2) as never,
      })
    ).toThrow(/32-byte hex/);
  });
});
