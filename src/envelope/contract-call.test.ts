import { keccak256, stringToHex } from "viem";
import { duskL1WireFormats } from "../l1/dusk-contract-interface.js";
import {
  decodeDuskContractCallEnvelope,
  DUSK_CONTRACT_CALL_TARGET,
  DUSK_CONTRACT_CALL_ENVELOPE_VERSION,
  DUSK_CONTRACT_CALL_KIND,
  DUSK_CONTRACT_CALL_RECEIVER_ENTRYPOINT,
  encodeDuskContractCallEnvelope,
} from "./contract-call.js";

const CONTRACT_ID = `0x${"11".repeat(32)}` as const;

describe("Dusk contract-call envelope", () => {
  it("derives the fixed target from the protocol label", () => {
    const digest = keccak256(stringToHex("dusk.network.xdm.contract-call"));
    expect(DUSK_CONTRACT_CALL_TARGET).toBe(`0x${digest.slice(-40)}`);
  });

  it("matches the contracts golden vector", () => {
    const encoded = encodeDuskContractCallEnvelope({
      targetContractId: CONTRACT_ID,
      entrypoint: DUSK_CONTRACT_CALL_RECEIVER_ENTRYPOINT,
      fnArgs: "0x223344",
    });

    expect(encoded).toBe(duskL1WireFormats.duskContractCallV1.goldenVectorHex);
    expect(encoded).toBe(`0x0101${"11".repeat(32)}223344`);
    expect(decodeDuskContractCallEnvelope(encoded)).toEqual({
      version: DUSK_CONTRACT_CALL_ENVELOPE_VERSION,
      kind: DUSK_CONTRACT_CALL_KIND,
      targetContractId: CONTRACT_ID,
      entrypoint: DUSK_CONTRACT_CALL_RECEIVER_ENTRYPOINT,
      fnArgs: "0x223344",
    });
  });

  it("accepts byte arguments and empty arguments", () => {
    expect(
      decodeDuskContractCallEnvelope(
        encodeDuskContractCallEnvelope({
          targetContractId: CONTRACT_ID,
          fnArgs: Uint8Array.of(0xaa, 0xbb),
        })
      ).fnArgs
    ).toBe("0xaabb");
    expect(
      decodeDuskContractCallEnvelope(
        encodeDuskContractCallEnvelope({ targetContractId: CONTRACT_ID })
      ).fnArgs
    ).toBe("0x");
  });

  it("rejects malformed versions, kinds, and targets", () => {
    const valid = encodeDuskContractCallEnvelope({ targetContractId: CONTRACT_ID });

    expect(() => decodeDuskContractCallEnvelope("0x0101")).toThrow(/at least 34 bytes/);
    expect(() => decodeDuskContractCallEnvelope(replaceByte(valid, 0, 2))).toThrow(/version: 2/);
    expect(() => decodeDuskContractCallEnvelope(replaceByte(valid, 1, 2))).toThrow(/kind: 2/);
    expect(() => encodeDuskContractCallEnvelope({ targetContractId: "0x1234" })).toThrow(
      /must be 32 bytes/
    );
    expect(() =>
      encodeDuskContractCallEnvelope({ targetContractId: `0x${"00".repeat(32)}` })
    ).toThrow(/must not be zero/);
    expect(() => decodeDuskContractCallEnvelope(`0x0101${"00".repeat(32)}aa`)).toThrow(
      /must not be zero/
    );
  });

  it("rejects caller-selected entrypoints", () => {
    expect(() =>
      encodeDuskContractCallEnvelope({ targetContractId: CONTRACT_ID, entrypoint: "set" })
    ).toThrow(/fixed dusk_xdm_execute receiver/);
  });
});

function replaceByte(hex: `0x${string}`, byteIndex: number, value: number): `0x${string}` {
  const body = hex.slice(2);
  const encoded = value.toString(16).padStart(2, "0");
  return `0x${body.slice(0, byteIndex * 2)}${encoded}${body.slice(byteIndex * 2 + 2)}`;
}
