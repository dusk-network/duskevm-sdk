import { decodeFunctionData, toFunctionSelector } from "viem";
import {
  L2_STANDARD_BRIDGE_ADDRESS,
  createDuskEvmContractBinding,
  encodeL2WithdrawalCall,
  erc20Abi,
  l2StandardBridgeAbi,
} from "./bindings.js";

describe("DuskEVM L2 bindings", () => {
  it("wraps viem-style readContract clients", async () => {
    const calls: unknown[] = [];
    const binding = createDuskEvmContractBinding({
      client: {
        async readContract(parameters) {
          calls.push(parameters);
          return 123n;
        },
      },
      address: "0x1111111111111111111111111111111111111111",
      abi: erc20Abi,
    });

    await expect(binding.read("balanceOf", ["0x2222222222222222222222222222222222222222"])).resolves.toBe(
      123n
    );
    expect(calls).toEqual([
      {
        address: "0x1111111111111111111111111111111111111111",
        abi: erc20Abi,
        functionName: "balanceOf",
        args: ["0x2222222222222222222222222222222222222222"],
      },
    ]);

    const { call } = binding;
    expect(call("balanceOf", ["0x2222222222222222222222222222222222222222"])).toMatchObject({
      to: "0x1111111111111111111111111111111111111111",
      data: expect.stringMatching(/^0x70a08231/),
    });
  });

  it("builds L2 withdrawal transaction calldata", () => {
    const withdrawTo = encodeL2WithdrawalCall({
      l2Token: "0x3333333333333333333333333333333333333333",
      recipient: "0x4444444444444444444444444444444444444444",
      amount: 10n,
      minGasLimit: 200_000,
      extraData: "0xabcd",
    });
    const withdraw = encodeL2WithdrawalCall({
      l2Token: "0x3333333333333333333333333333333333333333",
      amount: 10n,
      minGasLimit: 200_000,
      extraData: "0xabcd",
    });

    expect(withdrawTo.to).toBe(L2_STANDARD_BRIDGE_ADDRESS);
    expect(withdrawTo.data.slice(0, 10)).toBe(
      toFunctionSelector("withdrawTo(address,address,uint256,uint32,bytes)")
    );
    expect(decodeFunctionData({ abi: l2StandardBridgeAbi, data: withdrawTo.data })).toEqual({
      functionName: "withdrawTo",
      args: [
        "0x3333333333333333333333333333333333333333",
        "0x4444444444444444444444444444444444444444",
        10n,
        200_000,
        "0xabcd",
      ],
    });

    expect(withdraw.to).toBe(L2_STANDARD_BRIDGE_ADDRESS);
    expect(withdraw.data.slice(0, 10)).toBe(
      toFunctionSelector("withdraw(address,uint256,uint32,bytes)")
    );
    expect(decodeFunctionData({ abi: l2StandardBridgeAbi, data: withdraw.data })).toEqual({
      functionName: "withdraw",
      args: ["0x3333333333333333333333333333333333333333", 10n, 200_000, "0xabcd"],
    });
  });

  it("rejects L2 withdrawal min gas values outside uint32", () => {
    expect(() =>
      encodeL2WithdrawalCall({
        l2Token: "0x3333333333333333333333333333333333333333",
        amount: 10n,
        minGasLimit: 0x1_0000_0000,
      })
    ).toThrow(/minGasLimit must be a uint32/);
  });
});
