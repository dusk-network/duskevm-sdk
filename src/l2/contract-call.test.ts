import { decodeFunctionData, getAddress } from "viem";
import { DUSK_CONTRACT_CALL_TARGET } from "../envelope/index.js";
import { L2_CROSS_DOMAIN_MESSENGER_ADDRESS } from "./bindings.js";
import { prepareDuskContractCall } from "./contract-call.js";
import { l2CrossDomainMessengerAbi } from "./op-abis.js";

const CONTRACT_ID = `0x${"42".repeat(32)}` as const;

describe("Dusk contract-call preparation", () => {
  it("prepares a standard zero-value OP Messenger call", () => {
    const prepared = prepareDuskContractCall({
      targetContractId: CONTRACT_ID,
      entrypoint: "record_value",
      fnArgs: "0x1234",
      minGasLimit: 175_000,
    });

    expect(prepared.l2Transaction).not.toHaveProperty("value");
    expect(prepared.l2Transaction.to).toBe(L2_CROSS_DOMAIN_MESSENGER_ADDRESS);
    expect(prepared.envelope).toEqual({
      version: 1,
      kind: 1,
      targetContractId: CONTRACT_ID,
      entrypoint: "record_value",
      fnArgs: "0x1234",
    });
    expect(
      decodeFunctionData({
        abi: l2CrossDomainMessengerAbi,
        data: prepared.l2Transaction.data,
      })
    ).toEqual({
      functionName: "sendMessage",
      args: [getAddress(DUSK_CONTRACT_CALL_TARGET), prepared.envelopeHex, 175_000],
    });
  });

  it("normalizes a custom messenger and rejects invalid gas", () => {
    const prepared = prepareDuskContractCall({
      targetContractId: CONTRACT_ID,
      entrypoint: "ping",
      messengerAddress: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
    });
    expect(prepared.l2Transaction.to).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");

    expect(() =>
      prepareDuskContractCall({
        targetContractId: CONTRACT_ID,
        entrypoint: "ping",
        minGasLimit: -1,
      })
    ).toThrow(/minGasLimit/);
  });
});
