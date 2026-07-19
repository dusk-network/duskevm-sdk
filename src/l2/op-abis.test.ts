import type { Abi } from "viem";
import { toEventSelector, toFunctionSelector } from "viem";
import {
  l2CrossDomainMessengerAbi,
  l2Erc721BridgeAbi,
  l2StandardBridgeAbi,
  l2ToL1MessagePasserAbi,
  opContractsBedrockArtifactSource,
} from "./op-abis.js";

describe("generated OP L2 ABIs", () => {
  it("records the pinned artifact source", () => {
    expect(opContractsBedrockArtifactSource).toMatchObject({
      packageName: "@eth-optimism/contracts-bedrock",
      version: "0.17.3",
    });
    expect(opContractsBedrockArtifactSource.artifacts.map((artifact) => artifact.exportName)).toEqual([
      "l2CrossDomainMessengerAbi",
      "l2StandardBridgeAbi",
      "l2Erc721BridgeAbi",
      "l2ToL1MessagePasserAbi",
    ]);
  });

  it("contains the bridge and message-passer surface used by the SDK", () => {
    expect(
      hasAbiFunction(
        l2CrossDomainMessengerAbi,
        "sendMessage",
        ["address", "bytes", "uint32"],
        "payable"
      )
    ).toBe(true);
    expect(
      hasAbiFunction(
        l2StandardBridgeAbi,
        "withdraw",
        ["address", "uint256", "uint32", "bytes"],
        "payable"
      )
    ).toBe(true);
    expect(
      hasAbiFunction(
        l2StandardBridgeAbi,
        "withdrawTo",
        ["address", "address", "uint256", "uint32", "bytes"],
        "payable"
      )
    ).toBe(true);
    expect(
      hasAbiFunction(
        l2Erc721BridgeAbi,
        "bridgeERC721To",
        ["address", "address", "address", "uint256", "uint32", "bytes"],
        "nonpayable"
      )
    ).toBe(true);
    expect(
      hasAbiFunction(
        l2ToL1MessagePasserAbi,
        "initiateWithdrawal",
        ["address", "uint256", "bytes"],
        "payable"
      )
    ).toBe(true);
    expect(
      hasAbiEvent(
        l2StandardBridgeAbi,
        "WithdrawalInitiated",
        ["address", "address", "address", "address", "uint256", "bytes"],
        [true, true, true, false, false, false]
      )
    ).toBe(true);
    expect(
      hasAbiEvent(
        l2ToL1MessagePasserAbi,
        "MessagePassed",
        ["uint256", "address", "address", "uint256", "uint256", "bytes", "bytes32"],
        [true, true, true, false, false, false, false]
      )
    ).toBe(true);
  });

  it("preserves the SDK-observed function selectors and event topics", () => {
    expect(functionSelector(l2CrossDomainMessengerAbi, "sendMessage")).toBe(
      toFunctionSelector("sendMessage(address,bytes,uint32)")
    );
    expect(functionSelector(l2StandardBridgeAbi, "bridgeETHTo")).toBe(
      toFunctionSelector("bridgeETHTo(address,uint32,bytes)")
    );
    expect(functionSelector(l2StandardBridgeAbi, "withdraw")).toBe(
      toFunctionSelector("withdraw(address,uint256,uint32,bytes)")
    );
    expect(functionSelector(l2StandardBridgeAbi, "withdrawTo")).toBe(
      toFunctionSelector("withdrawTo(address,address,uint256,uint32,bytes)")
    );
    expect(functionSelector(l2Erc721BridgeAbi, "bridgeERC721To")).toBe(
      toFunctionSelector("bridgeERC721To(address,address,address,uint256,uint32,bytes)")
    );
    expect(functionSelector(l2ToL1MessagePasserAbi, "initiateWithdrawal")).toBe(
      toFunctionSelector("initiateWithdrawal(address,uint256,bytes)")
    );
    expect(eventTopic(l2StandardBridgeAbi, "WithdrawalInitiated")).toBe(
      toEventSelector("WithdrawalInitiated(address,address,address,address,uint256,bytes)")
    );
    expect(eventTopic(l2ToL1MessagePasserAbi, "MessagePassed")).toBe(
      toEventSelector("MessagePassed(uint256,address,address,uint256,uint256,bytes,bytes32)")
    );
  });
});

function hasAbiFunction(
  abi: Abi,
  name: string,
  inputTypes: string[],
  stateMutability: string
): boolean {
  return abi.some(
    (item) =>
      item.type === "function" &&
      item.name === name &&
      item.inputs.map((input) => input.type).join(",") === inputTypes.join(",") &&
      item.stateMutability === stateMutability
  );
}

function hasAbiEvent(
  abi: Abi,
  name: string,
  inputTypes: string[],
  indexed: boolean[]
): boolean {
  return abi.some(
    (item) =>
      item.type === "event" &&
      item.name === name &&
      item.inputs.map((input) => input.type).join(",") === inputTypes.join(",") &&
      item.inputs.map((input) => Boolean(input.indexed)).join(",") === indexed.join(",")
  );
}

function functionSelector(abi: Abi, name: string): `0x${string}` {
  const item = abi.find((entry) => entry.type === "function" && entry.name === name);
  if (!item || item.type !== "function") throw new Error(`missing function ${name}`);
  return toFunctionSelector(`${item.name}(${item.inputs.map((input) => input.type).join(",")})`);
}

function eventTopic(abi: Abi, name: string): `0x${string}` {
  const item = abi.find((entry) => entry.type === "event" && entry.name === name);
  if (!item || item.type !== "event") throw new Error(`missing event ${name}`);
  return toEventSelector(`${item.name}(${item.inputs.map((input) => input.type).join(",")})`);
}
