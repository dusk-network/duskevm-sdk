# Examples

## Decode an SDK Delivery Envelope

```ts
import { decodeDuskDeliveryEnvelope } from "@dusk-network/duskevm-sdk";

const decoded = decodeDuskDeliveryEnvelope("0x4445564d0104002a00000000...");
console.log(decoded.target);
```

## Prepare a Native Deposit

```ts
import { createBridgeClient, parseDuskToLux } from "@dusk-network/duskevm-sdk";

const bridge = createBridgeClient({
  contracts: {
    l1StandardBridgeContractId: "standard-bridge-contract-id",
  },
});

const deposit = bridge.prepareNativeDeposit({
  amountLux: parseDuskToLux("5"),
  l2Recipient: "0x1111111111111111111111111111111111111111",
});
```

## Prepare a DRC20 Deposit

```ts
const drc20Deposit = bridge.prepareDrc20Deposit({
  duskContractId: "0x1212121212121212121212121212121212121212121212121212121212121212",
  l1Token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  l2Token: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  amount: 1_000_000_000n,
  l2Recipient: "0x1111111111111111111111111111111111111111",
});
```

## Submit Through a Dusk Connect-compatible Wallet

```ts
import {
  createBridgeClient,
  createDuskConnectL1Client,
  parseDuskToLux,
} from "@dusk-network/duskevm-sdk";

const l1 = createDuskConnectL1Client(duskWallet);
const bridge = createBridgeClient({
  l1,
  contracts: {
    l1StandardBridgeContractId: "standard-bridge-contract-id",
  },
});

const deposit = bridge.prepareNativeDeposit({
  amountLux: parseDuskToLux("5"),
  l2Recipient: "0x1111111111111111111111111111111111111111",
});

const submitted = await bridge.submitPreparedOperation(deposit);
console.log(submitted.transactionHash);
```

## Wait for a Dusk L1 Transaction

```ts
import { waitForDuskL1Transaction } from "@dusk-network/duskevm-sdk/l1";

const receipt = await waitForDuskL1Transaction(l1, submitted.transactionHash, {
  timeoutMs: 120_000,
});

console.log(receipt.finalized);
```

## Build an L2 Withdrawal Call

```ts
import {
  encodeDuskExternalAssetRecipient,
  prepareNativeWithdrawal,
} from "@dusk-network/duskevm-sdk";

const duskRecipient = encodeDuskExternalAssetRecipient(compressedDuskPublicKey);

const withdrawal = prepareNativeWithdrawal({
  amountWei: 1_000_000_000_000_000_000n,
  recipient: "0x1111111111111111111111111111111111111111",
  extraData: duskRecipient,
});

console.log(withdrawal.l2Transaction.to, withdrawal.l2Transaction.data);
```

## Prepare DRC20 and DRC721 Withdrawals

```ts
import {
  prepareDrc20Withdrawal,
  prepareDrc721Withdrawal,
} from "@dusk-network/duskevm-sdk";

const drc20Withdrawal = prepareDrc20Withdrawal({
  l2Token: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  amount: 1_000_000_000n,
  recipient: "0x1111111111111111111111111111111111111111",
  extraData: duskRecipient,
});

const drc721Withdrawal = prepareDrc721Withdrawal({
  l1Token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  l2Token: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  tokenId: 7n,
  recipient: "0x1111111111111111111111111111111111111111",
  extraData: duskRecipient,
});
```

DRC721 withdrawals use the L2 ERC721 bridge predeploy. Native and DRC20
withdrawals use the L2 standard bridge.

## Parse a Withdrawal Message and Build L1 Requests

```ts
import {
  buildFinalizeWithdrawalTransaction,
  buildProveWithdrawalTransaction,
  parseMessagePassedReceipt,
} from "@dusk-network/duskevm-sdk";

const message = parseMessagePassedReceipt(l2Receipt);

const proveRequest = buildProveWithdrawalTransaction({
  portalContractId: "optimism-portal-contract-id",
  withdrawal: message.withdrawal,
  disputeGameIndex,
  outputRootProof,
  withdrawalProof,
  gasLimit: 1_000_000n,
});

const finalizeRequest = buildFinalizeWithdrawalTransaction({
  portalContractId: "optimism-portal-contract-id",
  withdrawal: message.withdrawal,
  gasLimit: 40_000_000n,
});

await l1.submitTransaction(proveRequest);
await l1.submitTransaction(finalizeRequest);
```

The SDK validates the `MessagePassed` withdrawal hash against the decoded event
payload. It does not decide which dispute game is valid or fetch storage proofs;
pass those observations in from your op-node/L2/Rusk integration.

## Track Withdrawal Status

```ts
import { withdrawalLifecycleStatus } from "@dusk-network/duskevm-sdk";

const status = withdrawalLifecycleStatus({
  operation: withdrawal,
  message,
  proof: {
    disputeGameIndex,
    outputRootProof,
    withdrawalProof,
  },
});

console.log(status.phase, status.metadata.stage);
```

The status helper is resumable: pass persisted operation IDs, L2 transaction
hashes, parsed messages, prove receipts, and finalize receipts as they become
available. Stages remain explicit, for example `proof_not_ready`,
`prove_ready`, `finalize_not_ready`, and `finalized`.
