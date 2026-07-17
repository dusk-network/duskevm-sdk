# DuskEVM SDK

`@dusk/evm-sdk` provides typed TypeScript helpers for applications that need to
coordinate Dusk L1 and DuskEVM L2 bridge and cross-domain contract workflows.

The `0.1.0-beta.3` line is a prerelease intended for integration testing. The
SDK deliberately stays thin: it helps applications build, submit, and track
cross-layer intents, but it does not decide canonical chain state and it does
not replace the DuskEVM adapter, op-node, Rusk, or wallet software.

## Current Scope

- Self-describing SDK deposit-envelope encode/decode diagnostics.
- Full-ID, zero-value L2-to-Dusk contract-call preparation through the standard
  OP cross-domain Messenger.
- Zero-value Dusk-to-DuskEVM contract-call preparation and submission through
  the deployed Dusk L1 Cross Domain Messenger.
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
- Native contract-credit parsing, authoritative state reads, lifecycle status,
  and claim transaction submission.
- Pluggable transaction builders, plus default builders for the DuskEVM bridge
  contract entrypoints.
- Generated Dusk L1 method metadata imported from the contracts project's
  narrow public interface.

The `bridge` withdrawal helpers validate canonical Dusk recipient metadata.
The lower-level `l2` encoding exports are raw OP ABI primitives for advanced
callers and intentionally do not apply those bridge-specific checks.

Application contract calls and bridge transfers are separate SDK operations.
Neither `prepareDuskContractCall` nor `prepareDuskEvmContractCall` can attach
value. DUSK, DRC20, and DRC721 value movement remains behind the typed bridge
helpers and bridge-owned recipient formats.

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

## Calls From Dusk To DuskEVM

Each deployment includes a Dusk `L1CrossDomainMessenger` contract. Applications
must obtain its full `contract_id` from the deployment address book or trusted
network configuration; it is deployment-specific and is not inferred from a
20-byte EVM address.

```ts
import {
  createDuskConnectL1Client,
  submitDuskEvmContractCall,
} from "@dusk/evm-sdk";

const l1 = createDuskConnectL1Client(duskWallet);
const message = await submitDuskEvmContractCall(
  l1,
  {
    messengerContractId: deployment.l1CrossDomainMessengerContractId,
    target: "0x1111111111111111111111111111111111111111",
    payload: "0x1234",
    minGasLimit: 250_000,
  },
  { wait: true }
);

console.log(message.submission.submitted.transactionHash);
```

The L2 receiver authenticates the standard L2 Messenger and reads the original
sender through `xDomainMessageSender()`. A direct wallet submission identifies
the originating Dusk account. To preserve a Dusk contract as the sender, that
contract must call the Dusk Messenger itself; an SDK transaction cannot
impersonate a contract caller.

This helper is zero-value. Native DUSK and token movement must use the typed
bridge APIs.

## Calls From DuskEVM To Dusk

An L2 application can target a Dusk contract by its complete 32-byte
`ContractId`. The SDK wraps that ID and the application payload in the
versioned contract-call envelope, then prepares a call to the standard OP L2
Messenger:

```ts
import { prepareDuskContractCall } from "@dusk/evm-sdk";

const call = prepareDuskContractCall({
  targetContractId:
    "0x1212121212121212121212121212121212121212121212121212121212121212",
  payload: "0x1234",
  minGasLimit: 150_000,
});

await walletClient.sendTransaction({
  account,
  to: call.l2Transaction.to,
  data: call.l2Transaction.data,
});
```

The receiving Dusk contract must expose `dusk_xdm_execute(payload)`, verify the
immediate L1 Messenger caller, and obtain the authenticated L2 sender from the
Messenger context. This path is intentionally zero-value; contract-directed
native DUSK uses `encodeDuskNativeContractCredit` with a native withdrawal.

For contract recipients, prefer `prepareNativeContractCreditWithdrawal`. It
derives the OP `to` address from the complete Dusk `ContractId`, preventing the
20-byte recipient and the actual credit target from disagreeing:

```ts
const withdrawal = bridge.prepareNativeContractCreditWithdrawal({
  targetContractId:
    "0x1212121212121212121212121212121212121212121212121212121212121212",
  amountWei: 1_000_000_000n,
  payload: "0x1234",
});

const message = parseMessagePassedReceipt(l2Receipt);
const expectedCredit = parseNativeCreditWithdrawal(message.withdrawal);

// After the normal OP prove/finalize stages:
const status = await bridge.observeNativeCredit(expectedCredit.creditId);
if (status.metadata?.stage === "credit_pending") {
  await bridge.submitNativeCreditClaim({
    creditId: expectedCredit.creditId,
    payload: expectedCredit.payload,
  }, { wait: true });

  const claimed = await bridge.readNativeCredit(expectedCredit.creditId);
  if (claimed.state !== "claimed") throw new Error(`unexpected credit state: ${claimed.state}`);
}
```

`observeNativeCredit` requires the configured Dusk L1 client to expose a
`readContract` adapter. Claims are permissionless, but the target, amount,
authenticated L2 sender, and payload hash are fixed by the finalized credit.
Contract-credit amounts must be exact LUX values (`amountWei % 10^9 === 0`) and
must fit Dusk's `u64` native transfer amount; the preparation and parsing
helpers reject invalid values before a claim is presented to the application.

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

DRC20 bridge amounts are preserved one-for-one as atomic units. The L2
`OptimismMintableERC20` representation should use the same `decimals()` value
as the DRC20. Canonical deployment tooling should query that value and use
`createOptimismMintableERC20WithDecimals`; the SDK and bridge do not rescale or
enforce token display metadata. Only native DUSK uses LUX/WEI conversion because
the native balance representations differ.

## Boundary

The SDK should:

- use viem for EVM/RPC primitives;
- adapt Dusk Connect or W3sper-like clients through interfaces;
- expose explicit operation metadata that applications can persist and resume;
- decode and structurally validate SDK deposit and contract-call envelopes.
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
- `@dusk/evm-sdk/envelope`: deposit and contract-call envelope codecs.
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
