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
import { encodeL2WithdrawalCall } from "@dusk-network/duskevm-sdk/l2";

const call = encodeL2WithdrawalCall({
  l2Token: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  recipient: "0x1111111111111111111111111111111111111111",
  amount: 1_000_000_000n,
  minGasLimit: 200_000,
  extraData: "0x",
});

console.log(call.to, call.data);
```
