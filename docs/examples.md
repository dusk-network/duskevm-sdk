# Examples

## Decode an SDK Deposit Envelope

```ts
import { decodeDuskDepositEnvelope } from "@dusk/evm-sdk";

const decoded = decodeDuskDepositEnvelope("0x4445564d0104002a00000000...");
console.log(decoded.target);
```

## Prepare an L2-to-Dusk Contract Call

```ts
import { prepareDuskContractCall } from "@dusk/evm-sdk";

const fnArgs = await targetContract.encode("record_value", { value: "42" });
const contractCall = prepareDuskContractCall({
  targetContractId:
    "0x1212121212121212121212121212121212121212121212121212121212121212",
  entrypoint: "record_value",
  fnArgs,
  minGasLimit: 150_000,
});

await walletClient.sendTransaction({
  account,
  to: contractCall.l2Transaction.to,
  data: contractCall.l2Transaction.data,
});
```

`fnArgs` is the target data driver's normal Piecrust encoding for the selected
entrypoint. This operation cannot carry value. Use the bridge withdrawal
helpers for DUSK, DRC20, or DRC721 transfers.

## Submit a Dusk-to-L2 Contract Call

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

The Messenger ContractId comes from the trusted deployment address book. This
operation cannot carry value. A Dusk contract that needs to be the authenticated
L2 sender must invoke the Messenger from inside that contract.

## Prepare a Native Deposit

```ts
import { createBridgeClient, parseDuskToLux } from "@dusk/evm-sdk";

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
} from "@dusk/evm-sdk";

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
import { waitForDuskL1Transaction } from "@dusk/evm-sdk/l1";

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
} from "@dusk/evm-sdk";

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
} from "@dusk/evm-sdk";

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

Token amounts in these calls are atomic units. Create the L2
`OptimismMintableERC20` with the same decimals as the DRC20 and pass the amount
unchanged; do not apply the native DUSK LUX/WEI conversion to DRC20 assets.

## Withdraw Native DUSK To A Contract

```ts
const withdrawal = bridge.prepareNativeContractCreditWithdrawal({
  targetContractId:
    "0x1212121212121212121212121212121212121212121212121212121212121212",
  amountWei: 1_000_000_000n,
  payload: "0x1234",
});

const message = parseMessagePassedReceipt(l2Receipt);
const credit = parseNativeCreditWithdrawal(message.withdrawal);

// Submit the normal prove and finalize requests first.
const pending = await bridge.observeNativeCredit(credit.creditId);
if (pending.metadata?.stage === "credit_pending") {
  await bridge.submitNativeCreditClaim({
    creditId: credit.creditId,
    payload: credit.payload,
  }, { wait: true });

  const claimed = await bridge.readNativeCredit(credit.creditId);
  if (claimed.state !== "claimed") throw new Error(`unexpected credit state: ${claimed.state}`);
}
```

The SDK derives the 20-byte OP recipient from the full Dusk contract ID. The
claim caller cannot replace the target, amount, original L2 sender, or payload.
The native value must be an exact multiple of `10^9` WEI and the resulting LUX
amount must fit `u64`; both preparation and message parsing enforce this.
The target opts in by implementing `receive_from_bridge`, authenticating the
transfer contract and Standard Bridge, and checking the bridge's active credit
context; no recipient registration transaction is involved.

## Parse a Withdrawal Message and Build L1 Requests

```ts
import {
  buildFinalizeWithdrawalTransaction,
  buildProveWithdrawalTransaction,
  parseMessagePassedReceipt,
} from "@dusk/evm-sdk";

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
import { withdrawalLifecycleStatus } from "@dusk/evm-sdk";

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
