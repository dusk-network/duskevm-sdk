# Cross-Domain Application Messaging

Generic application messages are asynchronous OP Messenger operations. They do
not provide synchronous reads across Dusk and DuskEVM, and they cannot carry
assets. Use the typed bridge APIs for native DUSK, DRC20, and DRC721 movement.

## DuskEVM To Dusk

The L2 transaction sends a versioned envelope to the fixed Dusk contract-call
protocol discriminator. The envelope contains the complete 32-byte Dusk
`ContractId` and opaque application payload. It does not use a registry or
truncate the destination to an EVM address.

```ts
import {
  createWithdrawalGameReader,
  findWithdrawalProof,
  submitDuskContractCall,
} from "@dusk/evm-sdk/xdm";
import { duskContractIdToEvmAddress } from "@dusk/evm-sdk";

const submitted = await submitDuskContractCall({
  publicClient: l2PublicClient,
  sendTransaction: (transaction) =>
    l2WalletClient.sendTransaction({ account, ...transaction }),
  expectedChainId: deployment.l2ChainId,
  l1MessengerAddress: duskContractIdToEvmAddress(
    deployment.l1CrossDomainMessengerContractId
  ),
  targetContractId: deployment.receiverContractId,
  payload: applicationPayload,
  wait: true,
});

const message = submitted.withdrawal!;
const proof = await findWithdrawalProof({
  l2Client: l2PublicClient,
  gameReader: createWithdrawalGameReader({
    reader: duskContractReader,
    portalContractId: deployment.optimismPortalContractId,
  }),
  withdrawalHash: message.withdrawalHash,
  withdrawalBlockNumber: message.blockNumber!,
});
```

The browser integration must supply a decoded `readContract` adapter for the
active deployment. It must return values in the following public-interface
shapes:

- Portal contract IDs and `gameContractId`: 32-byte hex or byte arrays.
- `gameCount` and L2 sequence numbers: unsigned integers or 32-byte U256 values.
- `gameAtIndex`: `[gameType, timestamp, gameProxy]`.
- `gameMetadataAtIndex`: `[rootClaim, l1Head, l2SequenceNumber, extraData]`.
- `isGameProper` and `isGameRespected`: booleans.
- `statusForGame`: `0` (in progress), `1` (challenger wins), or `2`
  (defender wins).

Missing `readContract` support is rejected before discovery starts.

Pass `message.withdrawal` and `proof` to the existing
`submitProveWithdrawalTransaction` helper. After proof maturity,
`readWithdrawalPortalState` reports `finalizable`; submit the existing finalize
helper and then call `readDuskMessageDeliveryState` with the relay message from
`parseCrossDomainMessageFromWithdrawal`.

If delivery failed, the returned state is explicitly replayable. Re-submit the
exact message with `submitDuskMessageReplayTransaction`. Changing any sender,
target, nonce, value, gas limit, or payload changes the authenticated message
hash and cannot reuse the failed-message authorization.

## Native Receiver Contract

The destination contract must:

- export `dusk_xdm_execute(payload: Vec<u8>)`;
- authenticate the immediate Dusk `L1CrossDomainMessenger` caller;
- read and authorize the original EVM sender through
  `xDomainMessageSender()`;
- validate and decode its application payload;
- return normally only after accepting and processing the message;
- panic or trap to reject delivery so the call remains replayable;
- make application processing idempotent.

The route rejects nonzero message value. A receiver must not treat the payload
as authenticated sender metadata.

## Dusk To DuskEVM

Use `submitDuskEvmContractCall` for the L1 transaction, then
`observeDuskEvmContractCallStatus` or `waitForDuskEvmContractCallStatus` for the
derived L2 relay. Both validate the expected L2 chain and canonical Messenger
predeploy before tracking. Pass the complete `SubmittedDuskEvmContractCall` as
`submitted`; the tracker resolves its native transaction hash through the
adapter, parses the projected native Messenger event, and accepts only a relay
event from the canonical L2 Messenger with the exact derived message hash.

The EVM receiver must authenticate `L2CrossDomainMessenger` as `msg.sender` and
authorize the original Dusk identity returned by `xDomainMessageSender()`.
Parse the L1 `SentMessage` receipt with its native Messenger's canonical EVM
address when an exact L2 replay is needed, then build the replay transaction:

```ts
const l1MessengerAddress = duskContractIdToEvmAddress(
  deployment.l1CrossDomainMessengerContractId
);
const message = parseSentMessageReceipt(l1Receipt, l1MessengerAddress);
const replay = buildDuskEvmMessageReplayTransaction(message);
```

## Trust Boundary

Proof discovery does not trust a standalone L2 RPC response. It verifies the
requested `sentMessages` key and value, validates the MPT inclusion proof against
the returned message-passer storage root, computes the output root, and accepts
it only when it equals a root claim from a game that the Portal considers proper
and historically respected and that has not resolved for the challenger. The
Portal remains authoritative for transaction-time admission checks.
