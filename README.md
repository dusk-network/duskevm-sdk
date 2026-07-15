# DuskEVM SDK

`@dusk/evm-sdk` provides typed TypeScript helpers for applications that need to
coordinate Dusk L1 and DuskEVM L2 bridge workflows.

The `0.1.0-beta.3` line is a prerelease intended for integration testing. The
SDK deliberately stays thin: it helps applications build, submit, and track
cross-layer intents, but it does not decide canonical chain state and it does
not replace the DuskEVM adapter, op-node, Rusk, or wallet software.

## Current Scope

- Self-describing SDK delivery-envelope encode/decode diagnostics.
- Dusk L1 client interfaces, submit/wait helpers, and a Dusk Connect-compatible
  wallet adapter.
- DuskEVM L2 chain/client helpers and viem ABI bindings.
- Cross-layer operation status primitives with resumable metadata.
- Bridge intent and submission helpers for native, DRC20, and DRC721 deposits.
- Deterministic L1-to-L2 deposit tracking from the adapter receipt through the
  DuskEVM cross-domain relay receipt.
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

The prerelease is prepared but is not yet available from npm. Once registry
publication is complete, install it from npm or JSR:

```sh
npm install @dusk/evm-sdk@beta
deno add jsr:@dusk/evm-sdk@0.1.0-beta.3
```

For repository development:

```sh
npm ci
npm run check
npm run smoke:local:dry-run
```

Supported targets are Node.js 22 and 24, Deno 2, and modern browsers using ESM.
The packed npm artifact is tested through every export path and a Vite browser
bundle. Bun and Cloudflare Workers remain unclaimed until they have dedicated
compatibility coverage.

## Quickstart

```ts
import {
  createBridgeClient,
  createDuskConnectL1Client,
  duskEvmTestnet,
  parseDuskToLux,
} from "@dusk/evm-sdk";

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

Applications can resume a submitted deposit from its Dusk transaction hash.
The observer distinguishes a missing receipt from a proven failure and derives
the OP L2 transaction hash from the adapter's `TransactionDeposited` log:

```ts
import { observeDepositStatus } from "@dusk/evm-sdk";

const status = await observeDepositStatus({
  l1Client: adapterPublicClient,
  l2Client: duskEvmPublicClient,
  l1TransactionHash: submitted.submittedTransaction.transactionHash,
});

console.log(status.metadata.stage, status.metadata.l2TransactionHash);
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
} from "@dusk/evm-sdk";

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

## Entrypoints

- `@dusk/evm-sdk`: complete public API.
- `@dusk/evm-sdk/bridge`: deposit, withdrawal, and lifecycle helpers.
- `@dusk/evm-sdk/envelope`: delivery-envelope codecs and diagnostics.
- `@dusk/evm-sdk/l1`: Dusk transaction clients, gas, and confirmation helpers.
- `@dusk/evm-sdk/l2`: DuskEVM chains, viem clients, ABIs, and raw call encoders.
- `@dusk/evm-sdk/status`: generic operation polling and status types.

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
for the optional local Rusk + DuskEVM SDK smoke harness. Maintainers should use
[docs/releasing.md](docs/releasing.md) for the manual release process.
