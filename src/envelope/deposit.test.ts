import {
  decodeDuskDepositEnvelope,
  encodeDuskDepositEnvelope,
  inspectDuskDepositEnvelope,
} from "./deposit.js";

describe("Dusk deposit envelope codec", () => {
  it("preserves the 0.1.0-beta.3 EVM-target wire fixture", () => {
    const fixture =
      "0x4445564d0104002a000000023078313131313131313131313131313131313131313131313131313131313131313131313131313131311234";

    expect(
      encodeDuskDepositEnvelope({
        target: {
          kind: "evm",
          value: "0x1111111111111111111111111111111111111111",
        },
        payload: "0x1234",
      })
    ).toBe(fixture);
    expect(decodeDuskDepositEnvelope(fixture)).toEqual({
      version: 1,
      target: {
        kind: "evm",
        value: "0x1111111111111111111111111111111111111111",
      },
      payload: "0x1234",
    });
  });

  it.each([
    ["native", "dusk1recipient111111111111111111111111111111111"],
    ["contract", "contract-id"],
    ["bls", "bls-public-key"],
    ["evm", "0x1111111111111111111111111111111111111111"],
    ["raw", "opaque-target"],
  ] as const)("roundtrips a %s-targeted envelope", (kind, value) => {
    const encoded = encodeDuskDepositEnvelope({
      target: {
        kind,
        value,
      },
      payload: "0x1234",
    });

    expect(decodeDuskDepositEnvelope(encoded)).toEqual({
      version: 1,
      target: {
        kind,
        value,
      },
      payload: "0x1234",
    });
  });

  it("returns diagnostics for malformed data", () => {
    const diagnostic = inspectDuskDepositEnvelope("0x1234");
    expect(diagnostic.ok).toBe(false);
    if (!diagnostic.ok) {
      expect(diagnostic.errors[0]).toMatch(/shorter/);
    }
  });

  it("diagnoses bad magic, unsupported versions, and length mismatches", () => {
    const valid = encodeDuskDepositEnvelope({
      target: { kind: "native", value: "dusk1recipient111111111111111111111111111111111" },
      payload: "0x1234",
    });

    const badMagic = mutateHexByte(valid, 0, 0);
    const badVersion = mutateHexByte(valid, 4, 2);
    const badLength = `${valid}ff` as const;

    expect(inspectDuskDepositEnvelope(badMagic)).toMatchObject({
      ok: false,
      errors: ["Deposit envelope magic mismatch"],
    });
    expect(inspectDuskDepositEnvelope(badVersion)).toMatchObject({
      ok: false,
      errors: ["Unsupported deposit envelope version: 2"],
    });
    expect(inspectDuskDepositEnvelope(badLength)).toMatchObject({
      ok: false,
      errors: [expect.stringMatching(/length mismatch/i)],
    });
  });

  it("accepts UTF-8 string payloads", () => {
    const encoded = encodeDuskDepositEnvelope({
      target: { kind: "contract", value: "contract-id" },
      payload: "hello",
    });

    expect(decodeDuskDepositEnvelope(encoded).payload).toBe("0x68656c6c6f");
  });

  it("rejects target values that cannot fit the envelope header", () => {
    expect(() =>
      encodeDuskDepositEnvelope({
        target: { kind: "raw", value: "x".repeat(0x10000) },
        payload: "0x",
      })
    ).toThrow(/deposit target is too large/i);
  });

  it("rejects payloads that cannot fit the envelope header", () => {
    const payload = new Proxy(new Uint8Array(0), {
      get(target, prop) {
        if (prop === "length") return 0x100000000;
        return Reflect.get(target, prop, target);
      },
    }) as Uint8Array;

    expect(() =>
      encodeDuskDepositEnvelope({
        target: { kind: "raw", value: "target" },
        payload,
      })
    ).toThrow(/deposit payload is too large/i);
  });
});

function mutateHexByte(hex: `0x${string}`, byteIndex: number, value: number): `0x${string}` {
  const chars = hex.slice(2).split("");
  chars[byteIndex * 2] = value.toString(16).padStart(2, "0")[0]!;
  chars[byteIndex * 2 + 1] = value.toString(16).padStart(2, "0")[1]!;
  return `0x${chars.join("")}`;
}
