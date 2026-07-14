# DuskEVM SDK

TypeScript helpers for applications that need to coordinate Dusk L1 and
DuskEVM L2 bridge workflows.

This package is an early, non-production SDK foundation. It deliberately stays
thin: the SDK helps applications build, submit, and track cross-layer intents,
but it does not decide canonical chain state and it does not replace the
DuskEVM adapter, op-node, Rusk, or wallet software.

## Current Scope

- Self-describing SDK delivery-envelope encode/decode diagnostics.
- Dusk L1 client interfaces, submit/wait helpers, and a Dusk Connect-compatible
  wallet adapter.
- DuskEVM L2 chain/client helpers and viem ABI bindings.
- Cross-layer operation status primitives with resumable metadata.
- Bridge intent and submission helpers for native, DRC20, and DRC721 deposits.
- Withdrawal helpers for native, DRC20, and DRC721 L2 initiation calls,
  `MessagePassed` receipt parsing, and L1 prove/finalize transaction requests.
- Versioned Dusk asset-recipient and native contract-credit encoders for bridge
  withdrawal `extraData`.
- Pluggable transaction builders, plus default builders for the DuskEVM bridge
  contract entrypoints.
- Generated Dusk L1 method metadata imported from the contracts project's
  narrow public interface.

The `bridge` withdrawal helpers validate canonical Dusk recipient metadata.
The lower-level `l2` encoding exports are raw OP ABI primitives for advanced
callers and intentionally do not apply those bridge-specific checks.

## Install

The package is not published yet. During development:

```sh
npm install
npm run check
npm run smoke:local:dry-run
```

## Quickstart

```ts
import {
  createBridgeClient,
  createDuskConnectL1Client,
  duskEvmTestnet,
  parseDuskToLux,
} from "@dusk-network/duskevm-sdk";

const l1 = createDuskConnectL1Client(duskWallet);

const bridge = createBridgeClient({
  l1,
  contracts: {
    l1StandardBridgeContractId: "standard-bridge-contract-id",
  },
  gas: {
    l1GasLimit: 900_000n,
  },
});

const submitted = await bridge.submitNativeDeposit({
  amountLux: parseDuskToLux("10"),
  l2Recipient: "0x1111111111111111111111111111111111111111",
});

console.log(duskEvmTestnet.id, submitted.submittedTransaction.transactionHash);
```

## Withdrawal Shape

Withdrawals are OP-style multi-stage operations. The SDK prepares the L2 call,
parses the `MessagePassed` receipt, and builds Dusk L1 portal requests for
prove/finalize. It does not select dispute games or synthesize withdrawal
proofs; those come from op-node/L2/Rusk observations.

```ts
import {
  buildFinalizeWithdrawalTransaction,
  buildProveWithdrawalTransaction,
  encodeDuskExternalAssetRecipient,
  parseMessagePassedReceipt,
  prepareNativeWithdrawal,
} from "@dusk-network/duskevm-sdk";

const duskRecipient = encodeDuskExternalAssetRecipient(compressedDuskPublicKey);

const withdrawal = prepareNativeWithdrawal({
  amountWei: 1_000_000_000_000_000_000n,
  recipient: "0x1111111111111111111111111111111111111111",
  extraData: duskRecipient,
});

await walletClient.sendTransaction({
  account,
  to: withdrawal.l2Transaction.to,
  data: withdrawal.l2Transaction.data,
  value: withdrawal.l2Transaction.value,
});

const message = parseMessagePassedReceipt(l2Receipt);

const prove = buildProveWithdrawalTransaction({
  portalContractId: "optimism-portal-contract-id",
  withdrawal: message.withdrawal,
  disputeGameIndex,
  outputRootProof,
  withdrawalProof,
});

const finalize = buildFinalizeWithdrawalTransaction({
  portalContractId: "optimism-portal-contract-id",
  withdrawal: message.withdrawal,
});
```

## Boundary

The SDK should:

- use viem for EVM/RPC primitives;
- adapt Dusk Connect or W3sper-like clients through interfaces;
- expose explicit operation metadata that applications can persist and resume;
- decode and structurally validate SDK delivery envelopes for user/tooling diagnostics.
- keep default gas prices for normal Dusk L1 calls node-derived or explicit,
  not deployment-priced by default.
- expose withdrawal stages without hiding the OP prove/finalize lifecycle.

The SDK should not:

- synthesize adapter runtime state;
- select dispute games or manufacture withdrawal proofs;
- canonicalize Dusk L1 data;
- hide OP-style bridge stages;
- assume one browser wallet or one node implementation.

## Contract Interface Updates

The private contracts repository produces an allowlisted public interface for
the SDK. The SDK commits only the generated TypeScript projection, not the
source artifact or private contract metadata. Import an artifact downloaded
from the contracts CI workflow with:

```sh
npm run import:l1-interface -- /path/to/dusk-l1-public-interface.json
npm run check
```

The import verifies the artifact digest, exact contract allowlist, every L1
method signature used by the SDK, and the public wire-format constants. The
generated metadata records the source revision and interface digest. Source
conformance and artifact publication remain owned by the private contracts CI;
the public SDK CI validates the committed projection as normal source code.

See [docs/architecture.md](docs/architecture.md) for the initial package
boundaries and follow-up work. See [docs/local-smoke.md](docs/local-smoke.md)
for the optional local Rusk + DuskEVM SDK smoke harness.
