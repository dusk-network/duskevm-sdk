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
- Pluggable transaction builders, plus default builders for the DuskEVM bridge
  contract entrypoints.

## Install

The package is not published yet. During development:

```sh
npm install
npm run check
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

## Boundary

The SDK should:

- use viem for EVM/RPC primitives;
- adapt Dusk Connect or W3sper-like clients through interfaces;
- expose explicit operation metadata that applications can persist and resume;
- decode and structurally validate SDK delivery envelopes for user/tooling diagnostics.
- keep default gas prices for normal Dusk L1 calls node-derived or explicit,
  not deployment-priced by default.

The SDK should not:

- synthesize adapter runtime state;
- canonicalize Dusk L1 data;
- hide OP-style bridge stages;
- assume one browser wallet or one node implementation.

See [docs/architecture.md](docs/architecture.md) for the initial package
boundaries and follow-up work.
