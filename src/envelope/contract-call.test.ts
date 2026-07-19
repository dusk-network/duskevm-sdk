import { keccak256, stringToHex } from "viem";
import { duskL1WireFormats } from "../l1/dusk-contract-interface.js";
import {
  decodeDuskContractCallEnvelope,
  DUSK_CONTRACT_CALL_TARGET,
  DUSK_CONTRACT_CALL_ENVELOPE_VERSION,
  DUSK_CONTRACT_CALL_KIND,
  encodeDuskContractCallEnvelope,
  MAX_DUSK_CONTRACT_CALL_ENTRYPOINT_BYTES,
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
      entrypoint: "set",
      fnArgs: "0x223344",
    });

    expect(encoded).toBe(duskL1WireFormats.duskContractCallV1.goldenVectorHex);
    expect(encoded).toBe(`0x0101${"11".repeat(32)}0003736574223344`);
    expect(decodeDuskContractCallEnvelope(encoded)).toEqual({
      version: DUSK_CONTRACT_CALL_ENVELOPE_VERSION,
      kind: DUSK_CONTRACT_CALL_KIND,
      targetContractId: CONTRACT_ID,
      entrypoint: "set",
      fnArgs: "0x223344",
    });
  });

  it("accepts byte arguments and empty arguments", () => {
    expect(
      decodeDuskContractCallEnvelope(
        encodeDuskContractCallEnvelope({
          targetContractId: CONTRACT_ID,
          entrypoint: "transfer_from",
          fnArgs: Uint8Array.of(0xaa, 0xbb),
        })
      ).fnArgs
    ).toBe("0xaabb");
    expect(
      decodeDuskContractCallEnvelope(
        encodeDuskContractCallEnvelope({
          targetContractId: CONTRACT_ID,
          entrypoint: "ping",
        })
      ).fnArgs
    ).toBe("0x");
  });

  it("rejects malformed versions, kinds, lengths, and targets", () => {
    const valid = encodeDuskContractCallEnvelope({
      targetContractId: CONTRACT_ID,
      entrypoint: "ping",
    });

    expect(() => decodeDuskContractCallEnvelope("0x0101")).toThrow(/at least 36 bytes/);
    expect(() => decodeDuskContractCallEnvelope(replaceByte(valid, 0, 2))).toThrow(/version: 2/);
    expect(() => decodeDuskContractCallEnvelope(replaceByte(valid, 1, 2))).toThrow(/kind: 2/);
    expect(() =>
      encodeDuskContractCallEnvelope({
        targetContractId: "0x1234",
        entrypoint: "ping",
      })
    ).toThrow(/must be 32 bytes/);
    expect(() =>
      encodeDuskContractCallEnvelope({
        targetContractId: `0x${"00".repeat(32)}`,
        entrypoint: "ping",
      })
    ).toThrow(/must not be zero/);
    expect(() =>
      decodeDuskContractCallEnvelope(`0x0101${"00".repeat(32)}0001aa`)
    ).toThrow(/must not be zero/);
    expect(() => decodeDuskContractCallEnvelope(replaceUint16(valid, 34, 0))).toThrow(
      /entrypoint length/
    );
    expect(() => decodeDuskContractCallEnvelope(replaceUint16(valid, 34, 64))).toThrow(
      /Truncated/
    );
  });

  it("rejects invalid, oversized, and reserved entrypoints", () => {
    for (const entrypoint of ["", "1transfer", "with-dash", "has space", "caf\u00e9"]) {
      expect(() =>
        encodeDuskContractCallEnvelope({ targetContractId: CONTRACT_ID, entrypoint })
      ).toThrow(/entrypoint/);
    }
    expect(() =>
      encodeDuskContractCallEnvelope({
        targetContractId: CONTRACT_ID,
        entrypoint: "a".repeat(MAX_DUSK_CONTRACT_CALL_ENTRYPOINT_BYTES + 1),
      })
    ).toThrow(/entrypoint length/);
    for (const entrypoint of ["init", "__constructor__"]) {
      expect(() =>
        encodeDuskContractCallEnvelope({ targetContractId: CONTRACT_ID, entrypoint })
      ).toThrow(/reserved/);
    }
  });

  it("rejects invalid UTF-8 in decoded entrypoints", () => {
    const valid = encodeDuskContractCallEnvelope({
      targetContractId: CONTRACT_ID,
      entrypoint: "a",
    });
    expect(() => decodeDuskContractCallEnvelope(replaceByte(valid, 36, 0xff))).toThrow(
      /valid UTF-8/
    );
  });
});

function replaceByte(hex: `0x${string}`, byteIndex: number, value: number): `0x${string}` {
  const body = hex.slice(2);
  const encoded = value.toString(16).padStart(2, "0");
  return `0x${body.slice(0, byteIndex * 2)}${encoded}${body.slice(byteIndex * 2 + 2)}`;
}

function replaceUint16(
  hex: `0x${string}`,
  byteIndex: number,
  value: number
): `0x${string}` {
  return replaceByte(replaceByte(hex, byteIndex, value >> 8), byteIndex + 1, value & 0xff);
}
