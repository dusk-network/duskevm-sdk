import {
  DUSK_EXTERNAL_ASSET_RECIPIENT_BYTES,
  compressedDuskBlsPublicKeyToEip2537,
  compressedDuskBlsPublicKeyToRaw,
  encodeDuskContractAssetRecipient,
  encodeDuskExternalAssetRecipient,
  encodeDuskNativeContractCredit,
  validateRawDuskBlsPublicKey,
  validateDuskAssetRecipient,
  validateDuskNativeContractCredit,
  validateDuskNativeWithdrawalRecipient,
} from "./asset-recipient.js";

const COMPRESSED_G2_GENERATOR =
  "0x93e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8" as const;
const RAW_G2_GENERATOR =
  "100a9402a28ff2f51a96b48726fbf5b380e52a3eb593a8a1e9ae3c1a9d9994986b36631863b7676fd7bc50439291810506f6239e75c0a9a5c360cdbc9dc5a0aa067886e2187eb13b67b34185ccb61a1b478515f20eedb6c2f3ed6073092a92114a4c4960f80a734c5a9c365e1ffa7c595a630aaa6c85e6e75f490d6ee9b5efbba225eff075a9d307e5da807e8efd83005db064df92fcc0addc61142b0a27aa18a0ebe43b6aacad863aa33dc94e5c4979edca3ca4505817e7f21bde63a1c22b0b00";
const EIP2537_G2_GENERATOR =
  "00000000000000000000000000000000024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8" +
  "0000000000000000000000000000000013e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e" +
  "000000000000000000000000000000000ce5d527727d6e118cc9cdc6da2e351aadfd9baa8cbdd3a76d429a695160d12c923ac9cc3baca289e193548608b82801" +
  "000000000000000000000000000000000606c4a02ea734cc32acd2b02bc28b99cb3e287e85a763af267492ab572e99ab3f370d275cec1da1aaa9075ff05f79be";
const CONTRACT_ID = `0x${"ab".repeat(32)}` as const;
const COMPRESSED_INFINITY = `0xc0${"00".repeat(95)}` as const;

describe("Dusk bridge recipient encoders", () => {
  it("matches the Rust raw BLS and EIP-2537 external-recipient fixtures", () => {
    expect(Buffer.from(compressedDuskBlsPublicKeyToRaw(COMPRESSED_G2_GENERATOR)).toString("hex"))
      .toBe(RAW_G2_GENERATOR);

    const recipient = encodeDuskExternalAssetRecipient(COMPRESSED_G2_GENERATOR);
    expect((recipient.length - 2) / 2).toBe(DUSK_EXTERNAL_ASSET_RECIPIENT_BYTES);
    expect(recipient).toBe(`0x020200${EIP2537_G2_GENERATOR}`);
    expect(
      Buffer.from(compressedDuskBlsPublicKeyToEip2537(COMPRESSED_G2_GENERATOR)).toString("hex")
    ).toBe(EIP2537_G2_GENERATOR);
    expect(Buffer.from(validateRawDuskBlsPublicKey(`0x${RAW_G2_GENERATOR}`)).toString("hex"))
      .toBe(RAW_G2_GENERATOR);
    expect(validateDuskAssetRecipient(recipient)).toBe(recipient);
    expect(validateDuskNativeWithdrawalRecipient(recipient)).toBe(recipient);
  });

  it("encodes contract recipients and native contract credits", () => {
    const recipient = encodeDuskContractAssetRecipient(CONTRACT_ID);
    const credit = encodeDuskNativeContractCredit(CONTRACT_ID, "0x1234");

    expect(recipient).toBe(`0x020101${"ab".repeat(32)}`);
    expect(validateDuskAssetRecipient(recipient)).toBe(recipient);
    expect(credit).toBe(`0x2001${"ab".repeat(32)}1234`);
    expect(validateDuskNativeContractCredit(credit)).toBe(credit);
    expect(validateDuskNativeWithdrawalRecipient(credit)).toBe(credit);
    expect(() => validateDuskNativeWithdrawalRecipient(recipient)).toThrow(
      /must be an external account or native contract credit/
    );
  });

  it("rejects legacy, malformed, and zero recipients", () => {
    expect(() => validateDuskAssetRecipient(`0x00${RAW_G2_GENERATOR}`)).toThrow(
      /unsupported tag or version/
    );
    expect(() => compressedDuskBlsPublicKeyToRaw("0x00")).toThrow(/must be 96 bytes/);
    expect(() => compressedDuskBlsPublicKeyToRaw(COMPRESSED_INFINITY)).toThrow(/not valid/);
    expect(() => validateDuskAssetRecipient(`0x020100${RAW_G2_GENERATOR}`)).toThrow(/unsupported/);
    expect(() => validateDuskAssetRecipient(`0x020200${"00".repeat(256)}`)).toThrow(/not valid/);
    expect(() =>
      validateRawDuskBlsPublicKey(
        `0x${"ff".repeat(48)}${RAW_G2_GENERATOR.slice(96)}`
      )
    ).toThrow(/not valid/);
    expect(() => encodeDuskContractAssetRecipient(`0x${"00".repeat(32)}`)).toThrow(
      /must not be zero/
    );
    expect(() => validateDuskNativeContractCredit("0x2001")).toThrow(/malformed/);
  });
});
