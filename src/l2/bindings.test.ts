import { decodeFunctionData, toFunctionSelector } from "viem";
import {
  L2_ERC721_BRIDGE_ADDRESS,
  L2_LEGACY_ERC20_ETH_ADDRESS,
  L2_STANDARD_BRIDGE_ADDRESS,
  createDuskEvmContractBinding,
  encodeL2Drc20WithdrawalCall,
  encodeL2Drc721WithdrawalCall,
  encodeL2NativeWithdrawalCall,
  encodeL2WithdrawalCall,
  erc20Abi,
  l2Erc721BridgeAbi,
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

  it("builds native and token withdrawal calls for the correct bridge predeploys", () => {
    const native = encodeL2NativeWithdrawalCall({
      recipient: "0x4444444444444444444444444444444444444444",
      amountWei: 10n,
      minGasLimit: 200_000,
      extraData: "0xabcd",
    });
    const drc20 = encodeL2Drc20WithdrawalCall({
      l2Token: "0x3333333333333333333333333333333333333333",
      recipient: "0x4444444444444444444444444444444444444444",
      amount: 10n,
      minGasLimit: 200_000,
      extraData: "0xabcd",
    });
    const drc721 = encodeL2Drc721WithdrawalCall({
      l1Token: "0x2222222222222222222222222222222222222222",
      l2Token: "0x3333333333333333333333333333333333333333",
      recipient: "0x4444444444444444444444444444444444444444",
      tokenId: 7n,
      minGasLimit: 200_000,
      extraData: "0xabcd",
    });

    expect(native.to).toBe(L2_STANDARD_BRIDGE_ADDRESS);
    expect(native.value).toBe(10n);
    expect(decodeFunctionData({ abi: l2StandardBridgeAbi, data: native.data })).toEqual({
      functionName: "bridgeETHTo",
      args: [
        "0x4444444444444444444444444444444444444444",
        200_000,
        "0xabcd",
      ],
    });

    expect(drc20.to).toBe(L2_STANDARD_BRIDGE_ADDRESS);
    expect(decodeFunctionData({ abi: l2StandardBridgeAbi, data: drc20.data })).toEqual({
      functionName: "withdrawTo",
      args: [
        "0x3333333333333333333333333333333333333333",
        "0x4444444444444444444444444444444444444444",
        10n,
        200_000,
        "0xabcd",
      ],
    });

    expect(drc721.to).toBe(L2_ERC721_BRIDGE_ADDRESS);
    expect(decodeFunctionData({ abi: l2Erc721BridgeAbi, data: drc721.data })).toEqual({
      functionName: "bridgeERC721To",
      args: [
        "0x3333333333333333333333333333333333333333",
        "0x2222222222222222222222222222222222222222",
        "0x4444444444444444444444444444444444444444",
        7n,
        200_000,
        "0xabcd",
      ],
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

    expect(() =>
      encodeL2Drc721WithdrawalCall({
        l1Token: "0x2222222222222222222222222222222222222222",
        l2Token: "0x3333333333333333333333333333333333333333",
        recipient: "0x4444444444444444444444444444444444444444",
        tokenId: 7n,
        minGasLimit: -1,
      })
    ).toThrow(/minGasLimit must be a uint32/);
  });

  it("rejects invalid DRC721 withdrawal token IDs as SDK operation errors", () => {
    expectDrc721TokenIdError("abc", /tokenId must be a uint256 value/);
    expectDrc721TokenIdError(1n << 256n, /tokenId does not fit uint256/);
  });

  it("rejects L2 withdrawal amounts outside uint256", () => {
    expect(() =>
      encodeL2NativeWithdrawalCall({
        recipient: "0x4444444444444444444444444444444444444444",
        amountWei: -1n,
        minGasLimit: 200_000,
      })
    ).toThrow(/native withdrawal amount does not fit uint256/);

    expect(() =>
      encodeL2Drc20WithdrawalCall({
        l2Token: "0x3333333333333333333333333333333333333333",
        recipient: "0x4444444444444444444444444444444444444444",
        amount: 1n << 256n,
        minGasLimit: 200_000,
      })
    ).toThrow(/DRC20 withdrawal amount does not fit uint256/);
  });
});

function expectDrc721TokenIdError(tokenId: string | bigint, message: RegExp): void {
  const build = () =>
    encodeL2Drc721WithdrawalCall({
      l1Token: "0x2222222222222222222222222222222222222222",
      l2Token: "0x3333333333333333333333333333333333333333",
      recipient: "0x4444444444444444444444444444444444444444",
      tokenId,
      minGasLimit: 200_000,
    });
  expect(build).toThrow(message);
  try {
    build();
  } catch (error) {
    expect(error).toMatchObject({ code: "INVALID_OPERATION" });
  }
}
