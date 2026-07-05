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
  buildL1Transaction(operation) {
    return {
      kind: "contract_call",
      contractId: "bridge-contract-id",
      method: "deposit",
      args: operation,
    };
  },
});

const deposit = bridge.prepareNativeDeposit({
  amountLux: parseDuskToLux("5"),
  l2Recipient: "0x1111111111111111111111111111111111111111",
});
```

## Submit Through a Dusk Connect-compatible Wallet

```ts
import {
  createBridgeClient,
  createDuskConnectL1Client,
} from "@dusk-network/duskevm-sdk";

const l1 = createDuskConnectL1Client(duskWallet);
const bridge = createBridgeClient({ l1, buildL1Transaction });

const submitted = await bridge.submitPreparedOperation(deposit);
console.log(submitted.transactionHash);
```
