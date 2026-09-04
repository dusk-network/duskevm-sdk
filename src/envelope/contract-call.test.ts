import { keccak256, stringToHex } from "viem";
import { duskL1WireFormats } from "../l1/dusk-contract-interface.js";
import {
  decodeDuskContractCallEnvelope,
  DUSK_CONTRACT_CALL_RECEIVER_ENTRYPOINT,
  DUSK_CONTRACT_CALL_TARGET,
  encodeDuskContractCallEnvelope,
} from "./contract-call.js";

const CONTRACT_ID = `0x${"11".repeat(32)}` as const;

describe("Dusk contract-call envelope", () => {
  it("derives the fixed target and receiver from the protocol", () => {
    const digest = keccak256(stringToHex("dusk.network.xdm.contract-call"));
    expect(DUSK_CONTRACT_CALL_TARGET).toBe(`0x${digest.slice(-40)}`);
    expect(DUSK_CONTRACT_CALL_RECEIVER_ENTRYPOINT).toBe("dusk_xdm_execute");
  });

  it("matches the current contracts golden vector", () => {
    const encoded = encodeDuskContractCallEnvelope({
      targetContractId: CONTRACT_ID,
      payload: "0x223344",
    });
    expect(encoded).toBe(duskL1WireFormats.duskContractCallV1.goldenVectorHex);
    expect(encoded).toBe(`0x0101${"11".repeat(32)}223344`);
    expect(decodeDuskContractCallEnvelope(encoded)).toEqual({
      version: 1,
      kind: 1,
      targetContractId: CONTRACT_ID,
      payload: "0x223344",
    });
  });

  it("accepts byte and empty payloads", () => {
    expect(
      decodeDuskContractCallEnvelope(
        encodeDuskContractCallEnvelope({
          targetContractId: CONTRACT_ID,
          payload: Uint8Array.of(0xaa, 0xbb),
        })
      ).payload
    ).toBe("0xaabb");
    expect(
      decodeDuskContractCallEnvelope(
        encodeDuskContractCallEnvelope({ targetContractId: CONTRACT_ID })
      ).payload
    ).toBe("0x");
  });

  it("rejects malformed versions, kinds, targets, and payload hex", () => {
    const valid = encodeDuskContractCallEnvelope({ targetContractId: CONTRACT_ID });
    expect(() => decodeDuskContractCallEnvelope("0x0101")).toThrow(/at least 34 bytes/);
    expect(() => decodeDuskContractCallEnvelope(replaceByte(valid, 0, 2))).toThrow(/version: 2/);
    expect(() => decodeDuskContractCallEnvelope(replaceByte(valid, 1, 2))).toThrow(/kind: 2/);
    expect(() =>
      encodeDuskContractCallEnvelope({ targetContractId: "0x1234", payload: "0x" })
    ).toThrow(/must be 32 bytes/);
    expect(() =>
      encodeDuskContractCallEnvelope({
        targetContractId: `0x${"00".repeat(32)}`,
      })
    ).toThrow(/must not be zero/);
    expect(() => decodeDuskContractCallEnvelope(`0x0101${"00".repeat(32)}`)).toThrow(
      /must not be zero/
    );
    expect(() =>
      encodeDuskContractCallEnvelope({ targetContractId: CONTRACT_ID, payload: "0x123" })
    ).toThrow(/byte hex/);
  });
});

function replaceByte(hex: `0x${string}`, byteIndex: number, value: number): `0x${string}` {
  const body = hex.slice(2);
  const encoded = value.toString(16).padStart(2, "0");
  return `0x${body.slice(0, byteIndex * 2)}${encoded}${body.slice(byteIndex * 2 + 2)}`;
}
